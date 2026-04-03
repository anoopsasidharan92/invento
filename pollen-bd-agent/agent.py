"""
BD Agent — generic, config-driven lead finder.
Run for a specific project with: python agent.py --project-dir /path/to/project
Defaults to the current working directory if --project-dir is omitted.
"""

import argparse
import os
import json
import sys
import time
import datetime
import hashlib
import requests
from pathlib import Path

from search import search_leads, search_channel
from config_loader import load_config

# ── CLI argument: project directory ───────────────────────────────────────────
parser = argparse.ArgumentParser(description="BD Lead Agent")
parser.add_argument(
    "--project-dir",
    default=None,
    help="Path to the project directory (contains config.json and data/)",
)
args = parser.parse_args()

PROJECT_DIR = Path(args.project_dir) if args.project_dir else Path.cwd()

# ── Config & paths ─────────────────────────────────────────────────────────────
cfg = load_config(project_dir=str(PROJECT_DIR))

OLLAMA_URL   = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2"
DATA_FILE    = str(PROJECT_DIR / "data" / "leads.json")
LOG_FILE     = str(PROJECT_DIR / "data" / "agent.log")
LINEAGE_FILE = str(PROJECT_DIR / "data" / "query_lineage.json")
CONFIG_FILE  = str(PROJECT_DIR / "config.json")


# ── Build qualifier prompt from config ─────────────────────────────────────────
def _build_qualifier_system(cfg: dict) -> str:
    schema = cfg["result_schema"]
    thresholds = cfg["score_thresholds"]
    hot_min  = thresholds["hot_min"]
    warm_min = thresholds["warm_min"]

    strong = "\n".join(f"- {s}" for s in cfg["strong_signals"])
    weak   = "\n".join(f"- {s}" for s in cfg["weak_signals"])
    categories = "|".join(schema["categories"])
    geographies = "|".join(schema["geographies"])
    signal_types = "|".join(schema["signal_types"])
    lead_field = schema["lead_name_field"]

    sender = cfg["sender_name"]
    company = cfg["sender_company"]
    company_desc = cfg["sender_description"]

    icp = cfg.get("ideal_customer_profile", "")
    what_we_offer = cfg.get("what_we_offer", "")

    icp_section = f"\nIdeal Customer Profile:\n{icp}\n" if icp else ""
    offer_section = f"\nWhat we offer:\n{what_we_offer}\n" if what_we_offer else ""

    return f"""
{cfg["qualifier_context"]}
{icp_section}{offer_section}
Your job: evaluate a raw search result and decide if it is a good prospective lead.

Strong signals (score high if present):
{strong}

Weak or irrelevant signals (score low or discard):
{weak}

Return ONLY valid JSON (no markdown, no explanation):
{{
  "{lead_field}": "...",
  "category": "{categories}",
  "country": "{geographies}",
  "fit_score": 1-10,
  "fit_reason": "1-2 sentence reason citing the specific signal found",
  "priority": "hot|warm|cold",
  "outreach_email": {{
    "subject": "...",
    "body": "..."
  }},
  "source_url": "...",
  "signal_type": "{signal_types}",
  "raw_snippet": "..."
}}

fit_score guide: {hot_min}-10 = hot (clear, specific signal matching ICP), {warm_min}-{hot_min - 1} = warm (indirect or partial signal), 1-{warm_min - 1} = cold (weak or no fit).
priority mirrors score: {hot_min}-10=hot, {warm_min}-{hot_min - 1}=warm, 1-{warm_min - 1}=cold.

Be strict: only score high if there is a concrete, specific signal. Generic industry news = cold.

The outreach email should:
- Be from {sender} at {company} ({company_desc})
- Open by referencing the exact signal found (e.g. "I saw that [company] is discontinuing X")
- Explain briefly what {company} offers and why it's relevant to their situation
- Be concise: 4-6 sentences max
- Subject line: specific and compelling, not generic or salesy
- Do NOT invent facts. Only reference what's in the snippet.
""".strip()


QUALIFIER_SYSTEM = _build_qualifier_system(cfg)


def _build_starred_context() -> str:
    """Load starred leads and format them as positive examples for the qualifier."""
    if not os.path.exists(DATA_FILE):
        return ""
    try:
        with open(DATA_FILE) as f:
            leads = json.load(f)
        examples = [l for l in leads.values() if l.get("starred")]
        if not examples:
            return ""
        lines = "\n".join(
            f"  - {l.get('company_name','?')} | signal={l.get('signal_type','?')} | country={l.get('country','?')} | snippet={l.get('raw_snippet','')[:120]}"
            for l in examples
        )
        return f"\n\nThe user has flagged these as GREAT leads (⭐ starred). Use them to calibrate your scoring — companies with similar profiles, signals, or language should score higher:\n{lines}\n"
    except Exception:
        return ""


# ── Helpers ────────────────────────────────────────────────────────────────────
def log(msg: str):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
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


def lead_id(url: str, snippet: str) -> str:
    return hashlib.md5((url + snippet[:80]).encode()).hexdigest()[:10]


def load_lineage() -> dict:
    """
    Load query lineage: {query_string -> {signal, generation, parent, created_at}}.
    Tracks the ancestry of every query so the LLM knows what's already been tried
    and can avoid re-generating the same query through different evolution steps.
    """
    if os.path.exists(LINEAGE_FILE):
        try:
            with open(LINEAGE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_lineage(lineage: dict):
    os.makedirs(os.path.dirname(LINEAGE_FILE), exist_ok=True)
    with open(LINEAGE_FILE, "w") as f:
        json.dump(lineage, f, indent=2)


def _seed_lineage_from_config(cfg: dict, lineage: dict) -> dict:
    """Ensure every query currently in config.json has a lineage entry (generation 0)."""
    changed = False
    for group in cfg.get("search_queries", []):
        signal = group["signal"]
        for q in group["queries"]:
            if q not in lineage:
                lineage[q] = {
                    "signal": signal,
                    "generation": 0,
                    "parent": None,
                    "created_at": datetime.datetime.now().isoformat(),
                }
                changed = True
    return lineage


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty LLM response")
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        text = text[first : last + 1]
    return json.loads(text)


# ── Core qualification ──────────────────────────────────────────────────────────
def qualify_result(result: dict):
    prompt = f"""
Search result to evaluate:
Title: {result.get('title', '')}
URL: {result.get('url', '')}
Snippet: {result.get('snippet', '')}
"""
    system = QUALIFIER_SYSTEM + _build_starred_context()
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "format": "json",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": prompt},
                ],
            },
            timeout=120,
        )
        resp.raise_for_status()
        text = resp.json()["message"]["content"].strip()
        return _extract_json(text)
    except Exception as e:
        log(f"  ⚠ Qualification error: {e}")
        return None


# ── Query evolution ────────────────────────────────────────────────────────────
MAX_LINEAGE_DEPTH = 4   # stop evolving a query chain after 4 generations
EVOLVE_QUERIES_PER_SIGNAL = 4  # new queries to generate per signal group


def _should_evolve(run_stats: dict, all_exhausted: bool) -> bool:
    """
    Decide whether to run query evolution after this run.
    Evolve when:
      - All queries are exhausted (nothing left to search), OR
      - The run produced very few useful results (most results were cold)
    """
    if all_exhausted:
        return True
    total   = run_stats.get("total_evaluated", 0)
    hot_warm = run_stats.get("hot_warm_saved", 0)
    # If we evaluated at least 5 results and less than 20% were useful → evolve
    if total >= 5 and (hot_warm / total) < 0.20:
        return True
    return False


def evolve_queries(cfg: dict, run_stats: dict, lineage: dict) -> bool:
    """
    Ask Ollama to evolve the current search queries based on:
    - What queries have already been tried (lineage)
    - How well the current run performed (run_stats)
    - What signals scored well in all-time leads
    - Starred / manually-added leads as positive anchors

    Writes updated search_queries back to config.json and updates lineage.
    Returns True if queries were changed.
    """
    log("  [evolve] Analysing run results to evolve search queries…")

    # ── Gather context ────────────────────────────────────────────────────────
    leads = load_leads()
    all_leads = list(leads.values())

    # Top performers — starred, manual, or high-scoring
    reference_leads = [
        l for l in all_leads
        if l.get("starred") or l.get("channel") == "manual" or l.get("fit_score", 0) >= cfg["score_thresholds"].get("hot_min", 8)
    ][-40:]
    # Recent cold results to show what's NOT working
    cold_leads = [
        l for l in all_leads
        if l.get("priority") == "cold"
    ][-20:]  # last 20 cold results

    ref_lines = "\n".join(
        f"  - {l.get('company_name','?')} | signal={l.get('signal_type','?')} | country={l.get('country','?')} | score={l.get('fit_score','?')} | snippet={l.get('raw_snippet','')[:100]}"
        for l in reference_leads
    ) or "  (none yet)"

    cold_lines = "\n".join(
        f"  - query_from={l.get('channel','?')} | signal={l.get('signal_type','?')} | reason={l.get('fit_reason','')[:80]}"
        for l in cold_leads
    ) or "  (none)"

    # Build lineage summary — what's been tried and how deep each chain is
    MAX_LINEAGE_SHOW = 60
    lineage_lines = "\n".join(
        f"  - [{v.get('signal','?')}] gen={v.get('generation',0)} | \"{q}\""
        for q, v in list(lineage.items())[-MAX_LINEAGE_SHOW:]
    )

    current_queries_json = json.dumps(cfg.get("search_queries", []), indent=2, ensure_ascii=False)
    icp           = cfg.get("ideal_customer_profile", "")
    strong        = "\n".join(f"  - {s}" for s in cfg.get("strong_signals", []))
    signal_types  = cfg.get("result_schema", {}).get("signal_types", [])
    geographies   = cfg.get("result_schema", {}).get("geographies", [])
    search_geo    = cfg.get("search_geo", "")

    prompt = f"""You are a B2B lead generation strategist. A search agent just completed a run and needs to evolve its search queries to find fresh leads.

ICP: {icp}

Strong signals to look for:
{strong}

Target geographies: {json.dumps(geographies)}
Search geo setting: {search_geo}
Valid signal types: {json.dumps(signal_types)}

CURRENT QUERIES (what's in rotation now):
{current_queries_json}

QUERIES ALREADY TRIED (full lineage — do NOT regenerate any of these):
{lineage_lines}

RUN PERFORMANCE:
- Total results evaluated: {run_stats.get('total_evaluated', 0)}
- Hot/warm leads saved: {run_stats.get('hot_warm_saved', 0)}
- Cold/skipped results: {run_stats.get('cold_skipped', 0)}
- All queries exhausted: {run_stats.get('all_exhausted', False)}

REFERENCE LEADS (starred, manual, or high-scoring — find more like these):
{ref_lines}

RECENT COLD RESULTS (signals that aren't working):
{cold_lines}

TASK:
Generate an evolved set of search_queries. Rules:
1. NEVER repeat a query that appears in the lineage above (exact match)
2. For each signal group, replace exhausted or low-performing queries with fresh ones
3. New queries must be meaningfully different — new keywords, different angles, adjacent industries, different geographies within the target set, or different trigger event language
4. Draw inspiration from the reference leads — what language, signals, company types, and geographies are in their snippets?
5. Avoid patterns that produced mostly cold results
6. Each query: 5-10 words, specific, includes at least one geo or industry qualifier
7. Keep {EVOLVE_QUERIES_PER_SIGNAL} queries per signal group
8. You may add a new signal group if the reference leads suggest an angle not covered yet

Output ONLY this JSON (no markdown):
{{
  "search_queries": [
    {{"signal": "signal_type", "queries": ["query 1", "query 2", ...]}}
  ],
  "evolution_notes": "1-2 sentences on what changed and why"
}}"""

    result = None
    last_error = None
    for attempt in range(1, 3):
        raw_text = ""
        try:
            resp = requests.post(
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "stream": False,
                    "format": "json",
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=180,
            )
            resp.raise_for_status()
            raw_text = resp.json().get("message", {}).get("content", "").strip()
            result = _extract_json(raw_text)
            break
        except Exception as e:
            last_error = e
            preview = (raw_text or "").replace("\n", " ")[:220]
            log(f"  [evolve] ⚠ Attempt {attempt}/2 failed: {e}. Raw preview: {preview or '(empty)'}")
            time.sleep(1.0)

    if not result:
        log(f"  [evolve] ⚠ LLM error during evolution: {last_error}")
        return False

    new_query_groups = result.get("search_queries", [])
    if not new_query_groups:
        log("  [evolve] ⚠ LLM returned empty queries — skipping evolution")
        return False

    evolution_notes = result.get("evolution_notes", "")
    log(f"  [evolve] {evolution_notes}")

    # ── Update lineage for new queries ────────────────────────────────────────
    old_query_set = {
        q
        for group in cfg.get("search_queries", [])
        for q in group["queries"]
    }
    now = datetime.datetime.now().isoformat()
    for group in new_query_groups:
        signal = group["signal"]
        for q in group["queries"]:
            if q not in lineage:
                # Find the parent — the old query in the same signal group with the lowest generation
                parent = None
                parent_gen = 0
                for old_group in cfg.get("search_queries", []):
                    if old_group["signal"] == signal:
                        for old_q in old_group["queries"]:
                            entry = lineage.get(old_q, {})
                            if entry.get("generation", 0) >= parent_gen:
                                parent = old_q
                                parent_gen = entry.get("generation", 0)
                new_gen = parent_gen + 1 if parent else 1
                lineage[q] = {
                    "signal": signal,
                    "generation": new_gen,
                    "parent": parent,
                    "created_at": now,
                }

    save_lineage(lineage)

    # ── Write evolved queries back to config.json ─────────────────────────────
    with open(CONFIG_FILE) as f:
        current_cfg = json.load(f)
    current_cfg["search_queries"] = new_query_groups
    with open(CONFIG_FILE, "w") as f:
        json.dump(current_cfg, f, indent=2)

    # ── Clear search history only for the new queries so they run next time ───
    history_path = PROJECT_DIR / "data" / "search_history.json"
    if history_path.exists():
        try:
            with open(history_path) as f:
                history = json.load(f)
            new_query_strings = {
                q.strip().lower()
                for group in new_query_groups
                for q in group["queries"]
            }
            keys_to_remove = [
                k for k in history
                if any(nq in k.lower() for nq in new_query_strings)
            ]
            for k in keys_to_remove:
                del history[k]
            with open(history_path, "w") as f:
                json.dump(history, f, indent=2)
        except Exception as e:
            log(f"  [evolve] ⚠ Could not update search history: {e}")

    added_count = sum(len(g["queries"]) for g in new_query_groups)
    log(f"  [evolve] Queries evolved — {added_count} queries across {len(new_query_groups)} signal groups ready for next run")
    return True


# ── Main run ───────────────────────────────────────────────────────────────────
STATUS_FILE = str(PROJECT_DIR / "data" / "status.json")


def write_status(job: str, state: str, detail: str):
    os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
    with open(STATUS_FILE, "w") as f:
        json.dump(
            {"job": job, "state": state, "detail": detail, "ts": datetime.datetime.now().isoformat()},
            f,
        )


def run():
    log("=" * 60)
    log(f"{cfg['agent_name']} — starting run (project: {PROJECT_DIR})")

    save_min   = cfg["score_thresholds"]["save_min"]
    hot_min    = cfg["score_thresholds"].get("hot_min", 8)
    warm_min   = cfg["score_thresholds"].get("warm_min", 5)
    batch_size = cfg.get("batch_size", 0)   # 0 = no batch limit (run all results)
    leads = load_leads()
    new_count = 0

    # Seed lineage from current config so existing queries are tracked
    lineage = load_lineage()
    lineage = _seed_lineage_from_config(cfg, lineage)
    save_lineage(lineage)

    log("Searching for leads...")
    search_result = search_leads(cfg, data_dir=PROJECT_DIR / "data")
    raw_results   = search_result["results"]
    all_exhausted = search_result["all_exhausted"]

    if all_exhausted:
        log(f"  All {search_result['total_queries']} search queries exhausted — triggering automatic evolution…")
        write_status("run", "running", "Queries exhausted — evolving search queries…")

    # ── Qualify results ────────────────────────────────────────────────────────
    run_stats = {
        "total_evaluated": 0,
        "hot_warm_saved":  0,
        "cold_skipped":    0,
        "all_exhausted":   all_exhausted,
    }

    if not all_exhausted:
        log(f"  Found {len(raw_results)} raw results to evaluate")

        for i, result in enumerate(raw_results, 1):
            lid = lead_id(result.get("url", ""), result.get("snippet", ""))

            if lid in leads:
                log(f"  [{i}/{len(raw_results)}] Skipping duplicate: {result.get('title','')[:60]}")
                continue

            ch = result.get("channel_label", result.get("channel", "?"))
            log(f"  [{i}/{len(raw_results)}] [{ch}] Qualifying: {result.get('title','')[:60]}")
            qualified = qualify_result(result)

            if not qualified:
                continue

            run_stats["total_evaluated"] += 1
            score = qualified.get("fit_score", 0)

            if score < save_min:
                log(f"    → Score {score} — below threshold ({save_min}), skipping")
                run_stats["cold_skipped"] += 1
                continue

            qualified["id"]            = lid
            qualified["found_at"]      = datetime.datetime.now().isoformat()
            qualified["status"]        = "new"
            qualified["notes"]         = ""
            if result.get("channel"):
                qualified["channel"]       = result["channel"]
                qualified["channel_label"] = result.get("channel_label", result["channel"])

            leads[lid] = qualified
            new_count += 1
            lead_name = qualified.get(cfg["result_schema"]["lead_name_field"], "?")
            log(f"    → Score {score} ({qualified['priority']}) — saved: {lead_name}")

            if score >= warm_min:
                run_stats["hot_warm_saved"] += 1
            else:
                run_stats["cold_skipped"] += 1

            save_leads(leads)

            if batch_size and new_count >= batch_size:
                log(f"  Batch of {batch_size} new leads found. Stopping this run.")
                break

            time.sleep(1.5)

    log(f"Run complete. {new_count} new leads added. Total: {len(leads)}")

    # ── Auto-evolve queries if needed ──────────────────────────────────────────
    if _should_evolve(run_stats, all_exhausted):
        write_status("run", "running", "Evolving search queries for next run…")
        evolved = evolve_queries(cfg, run_stats, lineage)
        if evolved:
            write_status("run", "done", f"Run complete — {new_count} new leads. Queries evolved for next run.")
        else:
            if all_exhausted:
                write_status("run", "exhausted", "All queries exhausted and evolution failed — check Ollama.")
            else:
                write_status("run", "done", f"Run complete — {new_count} new leads added.")
    else:
        write_status("run", "done", f"Run complete — {new_count} new leads added.")

    log("=" * 60)


if __name__ == "__main__":
    os.makedirs(str(PROJECT_DIR / "data"), exist_ok=True)
    run()
