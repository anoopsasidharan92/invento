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
import requests
import time

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


def search_leads(cfg: dict) -> list[dict]:
    """
    Run all configured queries across the prioritised channel list.
    Channels are tried in priority order; results from higher-priority channels
    come first, giving the qualifier the best signals earliest.
    """
    search_queries        = cfg["search_queries"]
    max_results_per_query = cfg.get("max_results_per_query", 5)
    search_geo            = cfg.get("search_geo", "in")

    # Priority-ordered channel list from config, fallback to defaults
    channels: list[str] = cfg.get("search_channels", DEFAULT_CHANNELS)
    # Filter to only known channels, preserve order
    channels = [c for c in channels if c in CHANNEL_CONFIG]
    if not channels:
        channels = DEFAULT_CHANNELS

    seen_urls: set[str] = set()
    all_results: list[dict] = []

    for channel in channels:
        ch_label = CHANNEL_CONFIG[channel]["label"]
        print(f"  [search] Channel: {ch_label}")
        for signal_group in search_queries:
            signal = signal_group["signal"]
            for query in signal_group["queries"]:
                results = search_channel(query, channel, max_results_per_query, search_geo)
                for r in results:
                    url = r.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        r["signal_hint"] = signal
                        all_results.append(r)
                time.sleep(0.5)

    return all_results
