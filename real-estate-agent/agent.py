"""
Real Estate Agent — config-driven property finder.
Run for a specific project with: python agent.py --project-dir /path/to/project
Defaults to the current working directory if --project-dir is omitted.
"""

import argparse
import os
import json
import time
import datetime
import hashlib
import requests
from pathlib import Path

from search import search_listings
from config_loader import load_config

parser = argparse.ArgumentParser(description="Real Estate Agent")
parser.add_argument(
    "--project-dir",
    default=None,
    help="Path to the project directory (contains config.json and data/)",
)
args = parser.parse_args()

PROJECT_DIR = Path(args.project_dir) if args.project_dir else Path.cwd()

cfg = load_config(project_dir=str(PROJECT_DIR))

OLLAMA_URL   = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2"
DATA_FILE    = str(PROJECT_DIR / "data" / "listings.json")
LOG_FILE     = str(PROJECT_DIR / "data" / "agent.log")
LINEAGE_FILE = str(PROJECT_DIR / "data" / "query_lineage.json")
CONFIG_FILE  = str(PROJECT_DIR / "config.json")
STATUS_FILE  = str(PROJECT_DIR / "data" / "status.json")


def _build_evaluator_system(cfg: dict) -> str:
    schema = cfg["result_schema"]
    thresholds = cfg["score_thresholds"]
    hot_min  = thresholds["hot_min"]
    warm_min = thresholds["warm_min"]

    must_haves = "\n".join(f"- {s}" for s in cfg.get("must_haves", []))
    nice_to_haves = "\n".join(f"- {s}" for s in cfg.get("nice_to_haves", []))
    deal_breakers = "\n".join(f"- {s}" for s in cfg.get("deal_breakers", []))
    property_types = "|".join(schema.get("property_types", []))
    localities = "|".join(schema.get("localities", []))

    listing_type = cfg.get("listing_type", "buy")
    budget = cfg.get("budget_range", "")
    bedrooms = cfg.get("bedrooms", "")
    location_pref = cfg.get("location_preference", "")

    return f"""You are a real estate search assistant evaluating property listings for a client.

Client requirements:
- Listing type: {listing_type}
- Budget range: {budget}
- Bedrooms: {bedrooms}
- Location preference: {location_pref}
{cfg.get("additional_requirements", "")}

Must-have features (score high if present):
{must_haves}

Nice-to-have features (bonus points):
{nice_to_haves}

Deal breakers (disqualify or score very low):
{deal_breakers}

Return ONLY valid JSON (no markdown, no explanation):
{{
  "property_name": "Short descriptive name of the property/listing",
  "property_type": "{property_types}",
  "locality": "Specific area/locality name",
  "city": "City name",
  "price": "Price as mentioned (e.g. ₹45 Lac, $350,000, ₹25,000/month)",
  "bedrooms": "Number of bedrooms (e.g. 2 BHK, 3 BHK, Studio)",
  "area_sqft": "Area if mentioned (e.g. 1200 sq.ft)",
  "match_score": 1-10,
  "match_reason": "1-2 sentence reason citing specific details from the listing",
  "priority": "hot|warm|cold",
  "key_features": ["feature1", "feature2", "feature3"],
  "listing_type": "rent|buy",
  "raw_snippet": "..."
}}

match_score guide: {hot_min}-10 = hot (matches most requirements closely), {warm_min}-{hot_min - 1} = warm (partial match, worth exploring), 1-{warm_min - 1} = cold (poor fit).
priority mirrors score: {hot_min}-10=hot, {warm_min}-{hot_min - 1}=warm, 1-{warm_min - 1}=cold.

Be strict: only score high if the listing concretely matches the client's requirements (budget, location, bedrooms, type).
If price or location doesn't match at all, score cold. Do NOT invent details not in the snippet.""".strip()


EVALUATOR_SYSTEM = _build_evaluator_system(cfg)


def _build_starred_context() -> str:
    if not os.path.exists(DATA_FILE):
        return ""
    try:
        with open(DATA_FILE) as f:
            listings = json.load(f)
        examples = [l for l in listings.values() if l.get("starred")]
        if not examples:
            return ""
        lines = "\n".join(
            f"  - {l.get('property_name','?')} | {l.get('locality','?')} | {l.get('price','?')} | {l.get('bedrooms','?')} | snippet={l.get('raw_snippet','')[:120]}"
            for l in examples
        )
        return f"\n\nThe client has marked these listings as favorites (starred). Use them to calibrate — similar properties should score higher:\n{lines}\n"
    except Exception:
        return ""


def log(msg: str):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def load_listings() -> dict:
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            return json.load(f)
    return {}


def save_listings(listings: dict):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(listings, f, indent=2)


def listing_id(url: str, snippet: str) -> str:
    return hashlib.md5((url + snippet[:80]).encode()).hexdigest()[:10]


def load_lineage() -> dict:
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
    changed = False
    for group in cfg.get("search_queries", []):
        signal = group.get("signal", "unknown")
        for q in group.get("queries", []):
            if q not in lineage:
                lineage[q] = {
                    "signal": signal,
                    "generation": 0,
                    "parent": None,
                    "created_at": datetime.datetime.now().isoformat(),
                }
                changed = True
    if changed:
        save_lineage(lineage)
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


def evaluate_result(result: dict):
    prompt = f"""
Property listing to evaluate:
Title: {result.get('title', '')}
URL: {result.get('url', '')}
Snippet: {result.get('snippet', '')}
"""
    system = EVALUATOR_SYSTEM + _build_starred_context()
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
        log(f"  ⚠ Evaluation error: {e}")
        return None


MAX_LINEAGE_DEPTH = 4
EVOLVE_QUERIES_PER_SIGNAL = 4


def _should_evolve(run_stats: dict, all_exhausted: bool) -> bool:
    if all_exhausted:
        return True
    total = run_stats.get("total_evaluated", 0)
    hot_warm = run_stats.get("hot_warm_saved", 0)
    if total >= 5 and (hot_warm / total) < 0.20:
        return True
    return False


def evolve_queries(cfg: dict, run_stats: dict, lineage: dict) -> bool:
    log("  [evolve] Analysing run results to evolve property search queries...")

    listings = load_listings()
    all_listings = list(listings.values())

    hot_min = cfg.get("score_thresholds", {}).get("hot_min", 8)
    reference_listings = [
        l for l in all_listings
        if l.get("starred") or l.get("channel") == "manual" or l.get("match_score", 0) >= hot_min
    ]
    cold_listings = [l for l in all_listings if l.get("priority") == "cold"][-20:]

    ref_lines = "\n".join(
        f"  - {l.get('property_name','?')} | {l.get('locality','?')} | {l.get('price','?')} | {l.get('bedrooms','?')} | score={l.get('match_score','?')} | snippet={l.get('raw_snippet','')[:100]}"
        for l in reference_listings
    ) or "  (none yet)"

    cold_lines = "\n".join(
        f"  - signal={l.get('signal_hint','?')} | reason={l.get('match_reason','')[:90]}"
        for l in cold_listings
    ) or "  (none)"

    lineage_lines = "\n".join(
        f"  - [{v.get('signal','?')}] gen={v.get('generation',0)} | \"{q}\""
        for q, v in list(lineage.items())[-80:]
    ) or "  (none)"

    current_queries_json = json.dumps(cfg.get("search_queries", []), indent=2, ensure_ascii=False)
    property_types = cfg.get("result_schema", {}).get("property_types", [])
    localities = cfg.get("result_schema", {}).get("localities", [])
    must_haves = "\n".join(f"  - {s}" for s in cfg.get("must_haves", [])) or "  (none)"
    deal_breakers = "\n".join(f"  - {s}" for s in cfg.get("deal_breakers", [])) or "  (none)"

    prompt = f"""You are a real-estate search strategist. A property discovery agent completed a run and needs better search queries for the next run.

Client criteria:
- Listing type: {cfg.get("listing_type", "")}
- Budget range: {cfg.get("budget_range", "")}
- Bedrooms: {cfg.get("bedrooms", "")}
- Location preference: {cfg.get("location_preference", "")}
- Additional requirements: {cfg.get("additional_requirements", "")}
- Target property types: {json.dumps(property_types)}
- Target localities: {json.dumps(localities)}
- Search geo: {cfg.get("search_geo", "")}

Must-haves:
{must_haves}

Deal-breakers:
{deal_breakers}

CURRENT QUERIES:
{current_queries_json}

QUERIES ALREADY TRIED (do NOT repeat exact query):
{lineage_lines}

RUN PERFORMANCE:
- Total listings evaluated: {run_stats.get("total_evaluated", 0)}
- Hot/warm listings saved: {run_stats.get("hot_warm_saved", 0)}
- Cold/skipped listings: {run_stats.get("cold_skipped", 0)}
- All queries exhausted: {run_stats.get("all_exhausted", False)}

REFERENCE LISTINGS (favorites/high-score; find more like these):
{ref_lines}

RECENT COLD LISTINGS (avoid these patterns):
{cold_lines}

TASK:
Generate an improved set of search_queries.
Rules:
1. NEVER repeat a query already in lineage (exact match).
2. Replace exhausted/weak queries with fresh, specific alternatives.
3. Keep each query 6-14 words with strong constraints (budget, BHK, locality, possession, property type, and/or amenity).
4. Include at least one concrete locality/city marker in each query where possible.
5. Exclude obvious deal-breaker patterns.
6. Keep {EVOLVE_QUERIES_PER_SIGNAL} queries per signal group.
7. You may add one new signal group if needed.

Output ONLY valid JSON:
{{
  "search_queries": [
    {{"signal": "signal_name", "queries": ["query 1", "query 2"]}}
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
    if evolution_notes:
        log(f"  [evolve] {evolution_notes}")

    now = datetime.datetime.now().isoformat()
    for group in new_query_groups:
        signal = group.get("signal", "unknown")
        for q in group.get("queries", []):
            if q in lineage:
                continue
            parent = None
            parent_gen = 0
            for old_group in cfg.get("search_queries", []):
                if old_group.get("signal") != signal:
                    continue
                for old_q in old_group.get("queries", []):
                    entry = lineage.get(old_q, {})
                    gen = int(entry.get("generation", 0))
                    if gen > parent_gen:
                        parent = old_q
                        parent_gen = gen
            new_gen = min(parent_gen + 1 if parent else 1, MAX_LINEAGE_DEPTH)
            lineage[q] = {
                "signal": signal,
                "generation": new_gen,
                "parent": parent,
                "created_at": now,
            }

    save_lineage(lineage)

    try:
        with open(CONFIG_FILE) as f:
            current_cfg = json.load(f)
        current_cfg["search_queries"] = new_query_groups
        with open(CONFIG_FILE, "w") as f:
            json.dump(current_cfg, f, indent=2)
    except Exception as e:
        log(f"  [evolve] ⚠ Could not write evolved queries to config: {e}")
        return False

    history_path = PROJECT_DIR / "data" / "search_history.json"
    if history_path.exists():
        try:
            with open(history_path) as f:
                history = json.load(f)
            new_query_strings = {
                q.strip().lower()
                for group in new_query_groups
                for q in group.get("queries", [])
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

    added_count = sum(len(g.get("queries", [])) for g in new_query_groups)
    log(f"  [evolve] Queries evolved — {added_count} queries across {len(new_query_groups)} signal groups")
    return True


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
    warm_min   = cfg["score_thresholds"].get("warm_min", 5)
    batch_size = cfg.get("batch_size", 0)
    listings = load_listings()
    new_count = 0

    lineage = load_lineage()
    lineage = _seed_lineage_from_config(cfg, lineage)

    history_path = PROJECT_DIR / "data" / "search_history.json"
    if not listings and history_path.exists():
        log("No listings found but search history exists — clearing cache for fresh search")
        history_path.unlink()

    log("Searching for property listings...")
    search_result = search_listings(cfg, data_dir=PROJECT_DIR / "data")
    raw_results = search_result["results"] if isinstance(search_result, dict) else search_result
    all_exhausted = bool(search_result.get("all_exhausted")) if isinstance(search_result, dict) else False
    if all_exhausted:
        log(f"  All {search_result.get('total_queries', 0)} search queries exhausted — triggering automatic evolution...")
        write_status("run", "running", "Queries exhausted — evolving search queries...")

    run_stats = {
        "total_evaluated": 0,
        "hot_warm_saved": 0,
        "cold_skipped": 0,
        "all_exhausted": all_exhausted,
    }

    log(f"  Found {len(raw_results)} raw results to evaluate")

    for i, result in enumerate(raw_results, 1):
        lid = listing_id(result.get("url", ""), result.get("snippet", ""))

        if lid in listings:
            log(f"  [{i}/{len(raw_results)}] Skipping duplicate: {result.get('title','')[:60]}")
            continue

        ch = result.get("channel_label", result.get("channel", "?"))
        log(f"  [{i}/{len(raw_results)}] [{ch}] Evaluating: {result.get('title','')[:60]}")
        evaluated = evaluate_result(result)

        if not evaluated:
            continue

        run_stats["total_evaluated"] += 1
        if evaluated.get("match_score", 0) < save_min:
            log(f"    → Score {evaluated['match_score']} — below threshold ({save_min}), skipping")
            run_stats["cold_skipped"] += 1
            continue

        evaluated["id"]            = lid
        evaluated["source_url"]    = result.get("url", "")
        evaluated["found_at"]      = datetime.datetime.now().isoformat()
        evaluated["status"]        = "new"
        evaluated["notes"]         = ""
        if result.get("channel"):
            evaluated["channel"]       = result["channel"]
            evaluated["channel_label"] = result.get("channel_label", result["channel"])

        listings[lid] = evaluated
        new_count += 1
        prop_name = evaluated.get("property_name", "?")
        log(f"    → Score {evaluated['match_score']} ({evaluated['priority']}) — saved: {prop_name}")
        if evaluated.get("match_score", 0) >= warm_min:
            run_stats["hot_warm_saved"] += 1
        else:
            run_stats["cold_skipped"] += 1

        save_listings(listings)

        if batch_size and new_count >= batch_size:
            log(f"  Batch of {batch_size} new listings found. Stopping this run.")
            break

        time.sleep(1.5)

    log(f"Run complete. {new_count} new listings added. Total: {len(listings)}")

    if _should_evolve(run_stats, all_exhausted):
        write_status("run", "running", "Evolving search queries for next run...")
        evolved = evolve_queries(cfg, run_stats, lineage)
        if evolved:
            write_status("run", "done", f"Run complete — {new_count} new listings. Queries evolved for next run.")
        else:
            if all_exhausted:
                write_status("run", "exhausted", "All queries exhausted and evolution failed — check Ollama.")
            else:
                write_status("run", "done", f"Run complete — {new_count} new listings added.")
    else:
        write_status("run", "done", f"Run complete — {new_count} new listings added.")

    log("=" * 60)


if __name__ == "__main__":
    os.makedirs(str(PROJECT_DIR / "data"), exist_ok=True)
    run()
