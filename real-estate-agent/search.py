"""
search.py — Property listing discovery via multi-channel web search.

Uses Serper.dev with smart query targeting:
  - For known portals, adds `inurl:` to force Google to return individual
    property pages, not generic search/category pages.
  - URL validation ensures only real property listing URLs are kept.
"""

import os
import json
import re
import datetime
import requests
import time
from pathlib import Path
from typing import Optional

SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "")

CHANNEL_CONFIG = {
    "99acres": {
        "label": "99acres",
        "site_prefix": "site:99acres.com ",
        "inurl_hint": "inurl:npspid ",
        "endpoint": "search",
    },
    "magicbricks": {
        "label": "MagicBricks",
        "site_prefix": "site:magicbricks.com ",
        "inurl_hint": "inurl:propertyDetails ",
        "endpoint": "search",
    },
    "housing": {
        "label": "Housing.com",
        "site_prefix": "site:housing.com ",
        "inurl_hint": "inurl:/page/ ",
        "endpoint": "search",
    },
    "nobroker": {
        "label": "NoBroker",
        "site_prefix": "site:nobroker.in ",
        "inurl_hint": "inurl:properties ",
        "endpoint": "search",
    },
    "zillow": {
        "label": "Zillow",
        "site_prefix": "site:zillow.com ",
        "inurl_hint": "inurl:homedetails ",
        "endpoint": "search",
    },
    "realtor": {
        "label": "Realtor.com",
        "site_prefix": "site:realtor.com ",
        "inurl_hint": "inurl:realestateandhomes-detail ",
        "endpoint": "search",
    },
    "propertyguru": {
        "label": "PropertyGuru",
        "site_prefix": "site:propertyguru.com ",
        "inurl_hint": "inurl:listing ",
        "endpoint": "search",
    },
    "rightmove": {
        "label": "Rightmove",
        "site_prefix": "site:rightmove.co.uk ",
        "inurl_hint": "inurl:properties ",
        "endpoint": "search",
    },
    "news": {
        "label": "News",
        "site_prefix": "",
        "inurl_hint": "",
        "endpoint": "news",
    },
    "google": {
        "label": "Google",
        "site_prefix": "",
        "inurl_hint": "",
        "endpoint": "search",
    },
}

DEFAULT_CHANNELS = ["99acres", "magicbricks", "housing", "google"]

# ── URL classification ──────────────────────────────────────────────────────────

_KNOWN_PORTAL_DOMAINS = [
    "99acres.com", "magicbricks.com", "housing.com", "nobroker.in",
    "zillow.com", "realtor.com", "redfin.com", "trulia.com",
    "rightmove.co.uk", "zoopla.co.uk", "propertyguru.com",
    "commonfloor.com", "makaan.com", "squareyards.com",
]

_PROPERTY_PAGE_PATTERNS = {
    "99acres.com":      re.compile(r"99acres\.com/.*npspid-", re.I),
    "magicbricks.com":  re.compile(r"magicbricks\.com/propertyDetails/", re.I),
    "housing.com":      re.compile(r"housing\.com/in/(?:buy|rent)/(?:resale|new|rental)/page/\d+-", re.I),
    "nobroker.in":      re.compile(r"nobroker\.in/properties/", re.I),
    "zillow.com":       re.compile(r"zillow\.com/homedetails/", re.I),
    "realtor.com":      re.compile(r"realtor\.com/realestateandhomes-detail/", re.I),
    "redfin.com":       re.compile(r"redfin\.com/[A-Z]{2}/[\w-]+/[\w-]+/home/\d+", re.I),
    "trulia.com":       re.compile(r"trulia\.com/p/", re.I),
    "rightmove.co.uk":  re.compile(r"rightmove\.co\.uk/properties/\d+", re.I),
    "zoopla.co.uk":     re.compile(r"zoopla\.co\.uk/for-sale/details/\d+", re.I),
    "commonfloor.com":  re.compile(r"commonfloor\.com/[\w-]+-[\w-]+/p[\w]+", re.I),
    "makaan.com":       re.compile(r"makaan\.com/[\w-]+/[\w-]+-\d+", re.I),
    "squareyards.com":  re.compile(r"squareyards\.com/[\w-]+/[\w-]+-\d+", re.I),
    "propertyguru.com": re.compile(r"propertyguru\.com[\.\w]*/listing/", re.I),
}


def _get_portal_domain(url: str) -> Optional[str]:
    url_lower = url.lower()
    for domain in _KNOWN_PORTAL_DOMAINS:
        if domain in url_lower:
            return domain
    return None


def _is_property_page(url: str) -> bool:
    if not url:
        return False
    domain = _get_portal_domain(url)
    if domain:
        pattern = _PROPERTY_PAGE_PATTERNS.get(domain)
        return bool(pattern and pattern.search(url))
    return True


# ── Serper search ───────────────────────────────────────────────────────────────

def _serper_request(endpoint: str, query: str, max_results: int, geo: str) -> list[dict]:
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
    cfg = CHANNEL_CONFIG.get(channel, CHANNEL_CONFIG["google"])

    if not SERPER_API_KEY:
        print(f"  [search] No SERPER_API_KEY — mock result for [{cfg['label']}] {query[:40]}")
        return [_mock_result(query, channel)]

    inurl_hint = cfg.get("inurl_hint", "")
    full_query = cfg["site_prefix"] + inurl_hint + query

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


# ── Search history ──────────────────────────────────────────────────────────────

def _load_search_history(data_dir: Path) -> dict:
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


# ── Main search pipeline ───────────────────────────────────────────────────────

def search_listings(cfg: dict, data_dir: Optional[Path] = None) -> dict:
    """
    Search across configured channels, using inurl: targeting for known portals
    to get individual property pages directly. Filter out any remaining
    search/category page URLs.
    """
    search_queries        = cfg["search_queries"]
    max_results_per_query = cfg.get("max_results_per_query", 5)
    search_geo            = cfg.get("search_geo", "in")
    force_all             = cfg.get("force_all_queries", False)

    channels: list[str] = cfg.get("search_channels", DEFAULT_CHANNELS)
    channels = [c for c in channels if c in CHANNEL_CONFIG]
    if not channels:
        channels = DEFAULT_CHANNELS

    history: dict = {}
    if data_dir and not force_all:
        history = _load_search_history(data_dir)

    seen_urls: set[str] = set()
    all_results: list[dict] = []
    now = datetime.datetime.now().isoformat()
    skipped = 0
    filtered = 0
    total_queries = 0

    for channel in channels:
        ch_label = CHANNEL_CONFIG[channel]["label"]
        print(f"  [search] Channel: {ch_label}")
        for signal_group in search_queries:
            signal = signal_group["signal"]
            for query in signal_group["queries"]:
                total_queries += 1
                history_key = f"{channel}::targeted::{query}"
                if history_key in history and not force_all:
                    skipped += 1
                    continue

                results = search_channel(query, channel, max_results_per_query, search_geo)
                for r in results:
                    url = r.get("url", "")
                    if not url or url in seen_urls:
                        continue

                    if _is_property_page(url):
                        seen_urls.add(url)
                        r["signal_hint"] = signal
                        all_results.append(r)
                    else:
                        filtered += 1
                        print(f"    [filter] Skipped non-property URL: {url[:80]}")

                history[history_key] = now
                time.sleep(0.5)

    if skipped:
        print(f"  [search] Skipped {skipped} previously executed queries (use force_all_queries to re-run)")
    if filtered:
        print(f"  [search] Filtered out {filtered} non-property URLs")

    if data_dir:
        _save_search_history(data_dir, history)

    return {
        "results": all_results,
        "total_queries": total_queries,
        "skipped": skipped,
        "filtered": filtered,
        "all_exhausted": skipped == total_queries and total_queries > 0,
    }
