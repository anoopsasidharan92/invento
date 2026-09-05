"""
search.py — Lead discovery via multi-channel web search.
Accepts a config dict so it can serve any project directory.
Uses Serper.dev (2500 free searches/month). **Requires `SERPER_API_KEY`** — there is no mock/fallback data.

For `google` and `news`, optional `exclude_marketplace_serp` (default True) appends `-site:` negatives
for large horizontal marketplaces and filters their URLs so results are not only Amazon/Flipkart.

Supported channels (in priority order configured by user):
  linkedin   → site:linkedin.com/company queries
  reddit     → site:reddit.com queries
  instagram  → site:instagram.com queries
  facebook   → site:facebook.com queries
  news       → Serper news endpoint
  google     → Plain Google search (default fallback)
"""

import hashlib
import os
import json
import datetime
import requests
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

_dotenv_loaded = False


def _get_serper_key() -> str:
    """Resolve API key from environment after loading repo + agent `.env` files."""
    global _dotenv_loaded
    if not _dotenv_loaded:
        _dotenv_loaded = True
        try:
            from dotenv import load_dotenv

            here = Path(__file__).resolve().parent
            # override=True: pick up values from .env even if SERPER_API_KEY is set but empty in the shell
            load_dotenv(here.parent / ".env", override=True)
            load_dotenv(here / ".env", override=True)
        except ImportError:
            pass
    return (os.environ.get("SERPER_API_KEY") or "").strip()


_no_serper_msg_printed = False


def _warn_no_serper_once() -> None:
    global _no_serper_msg_printed
    if _no_serper_msg_printed:
        return
    _no_serper_msg_printed = True
    print(
        "  [search] SERPER_API_KEY not set — returning no results (mock data disabled). "
        "Add the key to repo `.env` or `sales-deal-agent/.env`."
    )

# ── Channel definitions ─────────────────────────────────────────────────────────

CHANNEL_CONFIG = {
    "linkedin": {
        "label": "LinkedIn",
        "site_prefix": "site:linkedin.com/company ",
        "endpoint": "search",   # Serper /search endpoint
    },
    "reddit": {
        "label": "Reddit",
        "site_prefix": "site:reddit.com ",
        "endpoint": "search",
    },
    "instagram": {
        "label": "Instagram",
        "site_prefix": "site:instagram.com ",
        "endpoint": "search",
    },
    "facebook": {
        "label": "Facebook",
        "site_prefix": "site:facebook.com ",
        "endpoint": "search",
    },
    "news": {
        "label": "News",
        "site_prefix": "",          # No site prefix — use Serper's /news endpoint
        "endpoint": "news",
    },
    "google": {
        "label": "Google",
        "site_prefix": "",          # Plain Google search
        "endpoint": "search",
    },
}

DEFAULT_CHANNELS = ["linkedin", "google", "news", "reddit"]

# Open-web (google/news) queries for India often return only horizontal marketplaces.
# Negatives steer Serper toward brand sites, press, distributors, and forums.
_MARKETPLACE_NEGATIVE_SITES = (
    "-site:amazon.in -site:amazon.com -site:amazon.co.uk "
    "-site:flipkart.com -site:snapdeal.com -site:meesho.com"
)


def _url_is_horizontal_marketplace(url: str) -> bool:
    """True for big e‑commerce marketplaces we want to deprioritize for SERP diversity."""
    if not url or url.startswith("https://local.serper.placeholder"):
        return False
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return False
    if host.startswith("www."):
        host = host[4:]
    # Hostname or regional amazon TLD
    for needle in (
        "amazon.",
        "flipkart.",
        "snapdeal.",
        "meesho.",
    ):
        if needle in host:
            return True
    return False


def _serper_request(
    endpoint: str, query: str, max_results: int, geo: str, api_key: str
) -> list[dict]:
    """Call Serper API on the given endpoint (/search or /news)."""
    url = f"https://google.serper.dev/{endpoint}"
    try:
        resp = requests.post(
            url,
            headers={
                "X-API-KEY": api_key,
                "Content-Type": "application/json",
            },
            json={"q": query, "num": max_results, "gl": geo},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        # /search uses "organic", /news uses "news"
        items = data.get("organic", data.get("news", []))
        out = []
        for item in items[:max_results]:
            link = (item.get("link") or "").strip()
            title = item.get("title", "") or ""
            snip = item.get("snippet", "") or ""
            if not link:
                # Dedup logic requires a URL; synthesize stable placeholder
                h = hashlib.md5(f"{title}|{snip}".encode()).hexdigest()[:16]
                link = f"https://local.serper.placeholder/result/{h}"
            out.append({"title": title, "url": link, "snippet": snip})
        return out
    except Exception as e:
        print(f"  [search] Serper error ({endpoint}, query={query[:40]}): {e}")
        return []


def search_channel(
    query: str,
    channel: str,
    max_results: int,
    geo: str,
    *,
    exclude_marketplaces: bool = True,
) -> list[dict]:
    """Search a single channel, tagging each result with the channel."""
    cfg = CHANNEL_CONFIG.get(channel, CHANNEL_CONFIG["google"])
    full_query = cfg["site_prefix"] + query
    if exclude_marketplaces and channel in ("google", "news"):
        full_query = f"{full_query} {_MARKETPLACE_NEGATIVE_SITES}"

    # Request extra rows when we will drop marketplace URLs so slots stay filled.
    fetch_n = max_results
    if exclude_marketplaces and channel in ("google", "news"):
        fetch_n = min(max(max_results * 3, 12), 20)

    api_key = _get_serper_key()
    if not api_key:
        _warn_no_serper_once()
        return []

    results = _serper_request(cfg["endpoint"], full_query, fetch_n, geo, api_key)
    if exclude_marketplaces:
        results = [r for r in results if not _url_is_horizontal_marketplace((r.get("url") or "").strip())]
    results = results[:max_results]
    for r in results:
        r["channel"] = channel
        r["channel_label"] = cfg["label"]
    return results


def _load_search_history(data_dir: Path) -> dict:
    """Load search history: {channel::query -> last_run_iso}."""
    path = data_dir / "search_history.json"
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_search_history(data_dir: Path, history: dict):
    path = data_dir / "search_history.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(history, f, indent=2)


def search_leads(cfg: dict, data_dir: Optional[Path] = None) -> dict:
    """
    Run all configured queries across the prioritised channel list.
    Channels are tried in priority order; results from higher-priority channels
    come first, giving the qualifier the best signals earliest.

    Tracks executed queries in data/search_history.json so repeated runs
    skip queries that have already been searched. Pass force_all=True in
    config to bypass this.

    Returns a dict with:
      - results: list of search result dicts
      - total_queries: total number of channel+query combos
      - skipped: how many were skipped (already in history)
      - all_exhausted: True when every query was skipped
    """
    search_queries        = cfg["search_queries"]
    max_results_per_query = cfg.get("max_results_per_query", 5)
    search_geo            = cfg.get("search_geo", "in")
    force_all             = cfg.get("force_all_queries", False)
    exclude_marketplaces  = cfg.get("exclude_marketplace_serp", True)

    # Priority-ordered channel list from config, fallback to defaults
    channels: list[str] = cfg.get("search_channels", DEFAULT_CHANNELS)
    # Filter to only known channels, preserve order
    channels = [c for c in channels if c in CHANNEL_CONFIG]
    if not channels:
        channels = DEFAULT_CHANNELS

    # Load search history to skip previously executed queries
    history: dict = {}
    if data_dir and not force_all:
        history = _load_search_history(data_dir)

    if not _get_serper_key():
        _warn_no_serper_once()
        total_queries = sum(len(sg.get("queries", [])) for sg in search_queries) * len(channels)
        return {
            "results": [],
            "total_queries": total_queries,
            "skipped": 0,
            "all_exhausted": False,
        }

    seen_urls: set[str] = set()
    all_results: list[dict] = []
    now = datetime.datetime.now().isoformat()
    skipped = 0
    total_queries = 0

    for channel in channels:
        ch_label = CHANNEL_CONFIG[channel]["label"]
        print(f"  [search] Channel: {ch_label}")
        for signal_group in search_queries:
            signal = signal_group["signal"]
            for query in signal_group["queries"]:
                total_queries += 1
                history_key = f"{channel}::{query}"
                if history_key in history and not force_all:
                    skipped += 1
                    continue

                results = search_channel(
                    query,
                    channel,
                    max_results_per_query,
                    search_geo,
                    exclude_marketplaces=exclude_marketplaces,
                )
                for r in results:
                    url = (r.get("url") or "").strip()
                    if not url:
                        h = hashlib.md5(
                            f"{r.get('title', '')}|{r.get('snippet', '')}".encode()
                        ).hexdigest()[:16]
                        url = f"https://local.serper.placeholder/result/{h}"
                        r["url"] = url
                    if url not in seen_urls:
                        seen_urls.add(url)
                        r["signal_hint"] = signal
                        all_results.append(r)

                history[history_key] = now
                time.sleep(0.5)

    if skipped:
        print(f"  [search] Skipped {skipped}/{total_queries} previously executed queries (use force_all_queries to re-run)")

    # Persist updated history
    if data_dir:
        _save_search_history(data_dir, history)

    return {
        "results": all_results,
        "total_queries": total_queries,
        "skipped": skipped,
        "all_exhausted": skipped == total_queries and total_queries > 0,
    }
