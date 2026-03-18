"""
BD Agent — generic, config-driven lead finder.
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

from search import search_leads
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
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": prompt},
                ],
            },
            timeout=120,
        )
        resp.raise_for_status()
        text = resp.json()["message"]["content"].strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        log(f"  ⚠ Qualification error: {e}")
        return None


# ── Main run ───────────────────────────────────────────────────────────────────
def run():
    log("=" * 60)
    log(f"{cfg['agent_name']} — starting run (project: {PROJECT_DIR})")

    save_min   = cfg["score_thresholds"]["save_min"]
    batch_size = cfg.get("batch_size", 0)   # 0 = no batch limit (run all results)
    leads = load_leads()
    new_count = 0

    log("Searching for leads...")
    raw_results = search_leads(cfg)
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

        if qualified.get("fit_score", 0) < save_min:
            log(f"    → Score {qualified['fit_score']} — below threshold ({save_min}), skipping")
            continue

        qualified["id"]            = lid
        qualified["found_at"]      = datetime.datetime.now().isoformat()
        qualified["status"]        = "new"
        qualified["notes"]         = ""
        # Preserve channel info from the search result
        if result.get("channel"):
            qualified["channel"]       = result["channel"]
            qualified["channel_label"] = result.get("channel_label", result["channel"])

        leads[lid] = qualified
        new_count += 1
        lead_name = qualified.get(cfg["result_schema"]["lead_name_field"], "?")
        log(f"    → Score {qualified['fit_score']} ({qualified['priority']}) — saved: {lead_name}")

        # Save immediately so leads are visible in UI and safe if process is killed
        save_leads(leads)

        if batch_size and new_count >= batch_size:
            log(f"  Batch of {batch_size} new leads found. Stopping this run.")
            break

        time.sleep(1.5)

    log(f"Run complete. {new_count} new leads added. Total: {len(leads)}")
    log("=" * 60)


if __name__ == "__main__":
    os.makedirs(str(PROJECT_DIR / "data"), exist_ok=True)
    run()
