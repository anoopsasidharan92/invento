"""
cleanup.py — AI-powered lead deduplication and clutter removal.

Runs two passes:
  1. Exact/near-exact dedup: same URL or same normalized company name → keep best score.
  2. Semantic dedup: asks the LLM to group leads that clearly refer to the same company
     (spelling variants, "Inc" vs no suffix, regional offices, etc.) → keep best, merge notes.

Run for a specific project:
  python cleanup.py --project-dir /path/to/project
"""

import argparse
import json
import os
import re
import datetime
import requests
from pathlib import Path

from config_loader import load_config

# ── CLI ─────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="BD Lead Cleanup Agent")
parser.add_argument("--project-dir", default=None)
args = parser.parse_args()

PROJECT_DIR = Path(args.project_dir) if args.project_dir else Path.cwd()
cfg = load_config(project_dir=str(PROJECT_DIR))

DATA_FILE = str(PROJECT_DIR / "data" / "leads.json")
LOG_FILE  = str(PROJECT_DIR / "data" / "agent.log")

OLLAMA_URL   = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2"

# How many leads to send to the LLM at once for semantic grouping
BATCH_SIZE = 40


# ── Helpers ─────────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [cleanup] {msg}"
    print(line)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def load_leads() -> dict:
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            return json.load(f)
    return {}


def save_leads(leads: dict):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(leads, f, indent=2)


def _display_name(lead: dict) -> str:
    return (lead.get("brand_name") or lead.get("company_name") or
            lead.get("lead_name") or "").strip()


def _normalize(name: str) -> str:
    """Lowercase, strip punctuation/suffixes for fuzzy matching."""
    name = name.lower()
    name = re.sub(r"\b(inc|ltd|llc|pvt|co|corp|limited|gmbh|sdn bhd|berhad|pty)\b\.?", "", name)
    name = re.sub(r"[^a-z0-9 ]", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def _best_lead(leads: list[dict]) -> dict:
    """From a group of duplicate leads, keep the one with the highest score;
    prefer starred, then contacted/reviewed over new."""
    def rank(l: dict):
        starred = 1 if l.get("starred") else 0
        status_rank = {"contacted": 3, "reviewed": 2, "new": 1, "archived": 0}.get(l.get("status", "new"), 0)
        return (starred, status_rank, l.get("fit_score", 0))
    return max(leads, key=rank)


def _merge_notes(leads: list[dict]) -> str:
    """Concatenate non-empty notes from all duplicates."""
    seen = set()
    parts = []
    for l in leads:
        n = (l.get("notes") or "").strip()
        if n and n not in seen:
            seen.add(n)
            parts.append(n)
    return " | ".join(parts) if parts else ""


# ── Pass 1: Exact / near-exact dedup ────────────────────────────────────────────

def pass1_exact(leads: dict) -> tuple[dict, int]:
    """
    Group leads by:
      - identical source_url (excluding mock/example URLs)
      - identical normalized company name
    Keep the best from each group.
    """
    url_groups:  dict[str, list[str]] = {}   # url  → [lead_ids]
    name_groups: dict[str, list[str]] = {}   # norm → [lead_ids]

    for lid, lead in leads.items():
        url = (lead.get("source_url") or "").strip()
        if url and "example.com" not in url:
            url_groups.setdefault(url, []).append(lid)

        norm = _normalize(_display_name(lead))
        if norm:
            name_groups.setdefault(norm, []).append(lid)

    removed = 0
    cleaned = dict(leads)

    for group_ids in list(url_groups.values()) + list(name_groups.values()):
        # Only process groups still present in cleaned (prior passes may have removed some)
        group = [cleaned[i] for i in group_ids if i in cleaned]
        if len(group) <= 1:
            continue
        best = _best_lead(group)
        merged_notes = _merge_notes(group)
        if merged_notes:
            best["notes"] = merged_notes
        for lead in group:
            if lead["id"] != best["id"] and lead["id"] in cleaned:
                del cleaned[lead["id"]]
                removed += 1
                log(f"  [exact] removed duplicate: {_display_name(lead)!r} (kept: {_display_name(best)!r})")

    return cleaned, removed


# ── Pass 2: Semantic dedup via LLM ──────────────────────────────────────────────

SEMANTIC_SYSTEM = """You are a data deduplication assistant for a B2B lead database.

You will receive a JSON list of leads. Each lead has an id, name, country, and source_url.

Your task: identify groups of leads that clearly refer to THE SAME REAL-WORLD COMPANY.
Examples of duplicates:
- "Acme Corp" and "Acme Corporation" (same company, different suffix)
- "Nike India" and "Nike (India)" (same company, formatting variant)
- "Reliance Retail" and "Reliance Retail Ltd" (suffix variant)
- Same company found on LinkedIn and via a news article

DO NOT group together:
- Different subsidiaries or divisions that operate independently
- Unrelated companies that happen to share a generic word
- Companies in different countries (they may be separate entities)

Return ONLY valid JSON — a list of groups. Each group is a list of lead IDs.
Only include groups with 2+ IDs (i.e. actual duplicates). Skip unique leads entirely.

Example output:
[
  ["id1", "id2"],
  ["id3", "id4", "id5"]
]

If there are NO duplicates, return: []
"""


def _llm_find_duplicates(lead_list: list[dict]) -> list[list[str]]:
    """Ask the LLM to identify semantic duplicate groups in a batch of leads."""
    compact = [
        {
            "id":      l["id"],
            "name":    _display_name(l),
            "country": l.get("country", ""),
            "url":     (l.get("source_url") or "")[:80],
        }
        for l in lead_list
    ]
    prompt = json.dumps(compact, ensure_ascii=False)

    try:
        resp = requests.post(
            OLLAMA_URL,
            json={
                "model":  OLLAMA_MODEL,
                "stream": False,
                "messages": [
                    {"role": "system", "content": SEMANTIC_SYSTEM},
                    {"role": "user",   "content": prompt},
                ],
            },
            timeout=120,
        )
        resp.raise_for_status()
        text = resp.json()["message"]["content"].strip()

        # Strip markdown fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]

        groups = json.loads(text)
        if not isinstance(groups, list):
            return []
        # Validate: each group must be a list of strings
        return [g for g in groups if isinstance(g, list) and len(g) >= 2]

    except Exception as e:
        log(f"  [semantic] LLM error: {e}")
        return []


def pass2_semantic(leads: dict) -> tuple[dict, int]:
    """Run semantic grouping in batches; merge duplicates the LLM finds."""
    lead_list = list(leads.values())
    removed   = 0
    cleaned   = dict(leads)

    for batch_start in range(0, len(lead_list), BATCH_SIZE):
        batch = [l for l in lead_list[batch_start:batch_start + BATCH_SIZE] if l["id"] in cleaned]
        if not batch:
            continue
        log(f"  [semantic] Checking batch {batch_start // BATCH_SIZE + 1} ({len(batch)} leads)…")

        groups = _llm_find_duplicates(batch)
        for group_ids in groups:
            # Filter to IDs still present
            group = [cleaned[i] for i in group_ids if i in cleaned]
            if len(group) <= 1:
                continue
            best = _best_lead(group)
            merged_notes = _merge_notes(group)
            if merged_notes:
                best["notes"] = merged_notes
            for lead in group:
                if lead["id"] != best["id"] and lead["id"] in cleaned:
                    del cleaned[lead["id"]]
                    removed += 1
                    log(f"  [semantic] removed: {_display_name(lead)!r} (kept: {_display_name(best)!r})")

    return cleaned, removed


# ── Pass 3: Remove archived leads (optional housekeeping) ───────────────────────

def pass3_archived(leads: dict) -> tuple[dict, int]:
    """Remove leads the user has explicitly archived."""
    cleaned = {lid: l for lid, l in leads.items() if l.get("status") != "archived"}
    removed = len(leads) - len(cleaned)
    if removed:
        log(f"  [archived] removed {removed} archived leads")
    return cleaned, removed


# ── Main ────────────────────────────────────────────────────────────────────────

def run():
    log("=" * 60)
    log(f"Cleanup run for project: {PROJECT_DIR}")

    leads = load_leads()
    if not leads:
        log("No leads found. Nothing to clean up.")
        log("=" * 60)
        return

    total_before = len(leads)
    log(f"Starting with {total_before} leads")

    leads, r1 = pass1_exact(leads)
    log(f"Pass 1 (exact dedup):    removed {r1}")

    leads, r2 = pass2_semantic(leads)
    log(f"Pass 2 (semantic dedup): removed {r2}")

    leads, r3 = pass3_archived(leads)
    log(f"Pass 3 (archived):       removed {r3}")

    total_removed = r1 + r2 + r3
    save_leads(leads)
    log(f"Cleanup complete. {total_removed} leads removed. {len(leads)} remain.")
    log("=" * 60)

    # Write a summary for the backend to pick up
    summary = {
        "removed_exact":    r1,
        "removed_semantic": r2,
        "removed_archived": r3,
        "total_removed":    total_removed,
        "remaining":        len(leads),
    }
    summary_path = str(PROJECT_DIR / "data" / "cleanup_summary.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f)


if __name__ == "__main__":
    run()
