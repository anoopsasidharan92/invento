"""
search.py — Lead discovery via multi-channel web search.
Accepts a config dict so it can serve any project directory.
Uses Serper.dev (2500 free searches/month).

Supported channels (in priority order configured by user):
  linkedin   → site:linkedin.com/company queries
  reddit     → site:reddit.com queries
  instagram  → site:instagram.com queries
  facebook   → site:facebook.com queries
  news       → Serper news endpoint
  google     → Plain Google search (default fallback)
"""

import os
import json
import datetime
import requests
import time
from pathlib import Path
from typing import Optional

SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "")

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


def _serper_request(endpoint: str, query: str, max_results: int, geo: str) -> list[dict]:
    """Call Serper API on the given endpoint (/search or /news)."""
    url = f"https://google.serper.dev/{endpoint}"
    try:
        resp = requests.post(
            url,
            headers={
                "X-API-KEY": SERPER_API_KEY,
                "Content-Type": "application/json",
            },
            json={"q": query, "num": max_results, "gl": geo},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        # /search uses "organic", /news uses "news"
        items = data.get("organic", data.get("news", []))
        return [
            {
                "title":   item.get("title", ""),
                "url":     item.get("link", ""),
                "snippet": item.get("snippet", ""),
            }
            for item in items[:max_results]
        ]
    except Exception as e:
        print(f"  [search] Serper error ({endpoint}, query={query[:40]}): {e}")
        return []


def search_channel(query: str, channel: str, max_results: int, geo: str) -> list[dict]:
    """Search a single channel, tagging each result with the channel."""
    cfg = CHANNEL_CONFIG.get(channel, CHANNEL_CONFIG["google"])
    full_query = cfg["site_prefix"] + query

    if not SERPER_API_KEY:
        print(f"  [search] No SERPER_API_KEY — mock result for [{cfg['label']}] {query[:40]}")
        return [_mock_result(query, channel)]

    results = _serper_request(cfg["endpoint"], full_query, max_results, geo)
    for r in results:
        r["channel"] = channel
        r["channel_label"] = cfg["label"]
    return results


def _mock_result(query: str, channel: str) -> dict:
    cfg = CHANNEL_CONFIG.get(channel, CHANNEL_CONFIG["google"])
    return {
        "title":         f"[MOCK/{cfg['label']}] Result for: {query[:40]}",
        "url":           "https://example.com/mock",
        "snippet":       "This is a mock result. Set SERPER_API_KEY to get real search results.",
        "channel":       channel,
        "channel_label": cfg["label"],
    }


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

                results = search_channel(query, channel, max_results_per_query, search_geo)
                for r in results:
                    url = r.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        r["signal_hint"] = signal
                        all_results.append(r)

                # Record this query as executed
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
