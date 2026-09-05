"""Sales Deal Agent — API routes (parallel to Pollen BD)."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Dict

import requests
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

SD_DIR = Path(__file__).resolve().parent.parent / "sales-deal-agent"
SD_PROJECTS_DIR = SD_DIR / "projects"
SD_PROJECTS_FILE = SD_DIR / "projects.json"

router = APIRouter(tags=["sales-deals"])

# ─── Ollama config ────────────────────────────────────────────────────────
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "localhost")
OLLAMA_URL   = f"http://{OLLAMA_HOST}:11434/api/chat"


def _sd_parse_env_file(path: Path) -> dict:
    out: dict = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("'\"")
    return out


def _sd_merge_dotenv_into_env(env: dict) -> None:
    """Apply repo-root `.env` then `sales-deal-agent/.env` (same order as search.py)."""
    for path in (SD_DIR.parent / ".env", SD_DIR / ".env"):
        for k, v in _sd_parse_env_file(path).items():
            env[k] = v


def _sd_serper_configured() -> bool:
    """True if Serper.dev API key is available (env + repo `.env` + agent `.env`)."""
    if os.environ.get("SERPER_API_KEY", "").strip():
        return True
    for path in (SD_DIR.parent / ".env", SD_DIR / ".env"):
        data = _sd_parse_env_file(path)
        if data.get("SERPER_API_KEY", "").strip():
            return True
    return False


def _sd_hunt_text(cfg: dict) -> str:
    """What the user is hunting — must match agent.py / qualifier."""
    pf = (cfg.get("product_focus") or "").strip()
    icp = (cfg.get("ideal_customer_profile") or "").strip()
    parts = []
    if pf:
        parts.append(f"Product / deal focus: {pf}")
    if icp:
        parts.append(f"Region & buyer context: {icp}")
    return "\n".join(parts).strip()


def _sd_project_dir(pid: str) -> Path:
    return SD_PROJECTS_DIR / pid


def _sd_project_paths(pid: str):
    """Returns (config_path, data_path, log_path) for a project."""
    d = _sd_project_dir(pid)
    return d / "config.json", d / "data" / "deals.json", d / "data" / "agent.log"


def _sd_load_projects() -> list:
    if SD_PROJECTS_FILE.exists():
        with open(SD_PROJECTS_FILE) as f:
            return json.load(f)
    return []


def _sd_save_projects(projects: list):
    SD_PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SD_PROJECTS_FILE, "w") as f:
        json.dump(projects, f, indent=2)


def _sd_load_deals(data_path: Path) -> dict:
    if data_path.exists():
        with open(data_path) as f:
            return json.load(f)
    return {}


def _sd_save_deals(data_path: Path, deals: dict):
    data_path.parent.mkdir(parents=True, exist_ok=True)
    with open(data_path, "w") as f:
        json.dump(deals, f, indent=2)


def _sd_status_path(pid: str) -> Path:
    return _sd_project_dir(pid) / "data" / "status.json"


def _sd_write_status(pid: str, job: str, state: str, detail: str = ""):
    import datetime as _dt

    path = _sd_status_path(pid)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(
            {
                "job": job,
                "state": state,
                "detail": detail,
                "ts": _dt.datetime.now().isoformat(),
            },
            f,
        )


def _sd_read_status(pid: str) -> dict:
    path = _sd_status_path(pid)
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {"job": "idle", "state": "done", "detail": "", "ts": ""}


_sd_procs: Dict[str, "subprocess.Popen[bytes]"] = {}


def _sd_get_project(pid: str) -> dict:
    projects = _sd_load_projects()
    for p in projects:
        if p["id"] == pid:
            return p
    raise HTTPException(404, f"Project '{pid}' not found")


@router.get("/sales-deals/projects")
def sd_list_projects():
    """List all Sales Deal agent projects with their configured status."""
    projects = _sd_load_projects()
    result = []
    for p in projects:
        cfg_path, _, _ = _sd_project_paths(p["id"])
        result.append({**p, "configured": cfg_path.exists()})
    return result


@router.post("/sales-deals/projects", status_code=201)
def sd_create_project(data: dict):
    """Create a new Sales Deal agent project."""
    import uuid, datetime as _dt
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Project name is required")
    pid = str(uuid.uuid4())[:8]
    project_dir = _sd_project_dir(pid)
    (project_dir / "data").mkdir(parents=True, exist_ok=True)
    projects = _sd_load_projects()
    entry = {"id": pid, "name": name, "created_at": _dt.datetime.now().isoformat()}
    projects.append(entry)
    _sd_save_projects(projects)
    return {**entry, "configured": False}


@router.patch("/sales-deals/projects/{pid}")
def sd_rename_project(pid: str, data: dict):
    """Rename a project."""
    _sd_get_project(pid)
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Project name is required")
    projects = _sd_load_projects()
    for p in projects:
        if p["id"] == pid:
            p["name"] = name
            break
    _sd_save_projects(projects)
    cfg_path, _, _ = _sd_project_paths(pid)
    updated = next(p for p in projects if p["id"] == pid)
    return {**updated, "configured": cfg_path.exists()}


@router.delete("/sales-deals/projects/{pid}", status_code=204)
def sd_delete_project(pid: str):
    """Delete a project and all its data."""
    import shutil
    _sd_get_project(pid)
    project_dir = _sd_project_dir(pid)
    if project_dir.exists():
        shutil.rmtree(project_dir)
    projects = _sd_load_projects()
    projects = [p for p in projects if p["id"] != pid]
    _sd_save_projects(projects)


# ── Project-scoped endpoints ──────────────────────────────────────────────────

@router.get("/sales-deals/{pid}/deals")
def sd_leads(pid: str, status: str = "", priority: str = ""):
    _sd_get_project(pid)
    _, data_path, _ = _sd_project_paths(pid)
    leads = _sd_load_deals(data_path)
    items = list(leads.values())
    if status:
        items = [l for l in items if l.get("status") == status]
    if priority:
        items = [l for l in items if l.get("priority") == priority]
    priority_order = {"hot": 0, "warm": 1, "cold": 2}
    items.sort(key=lambda x: priority_order.get(x.get("priority", "cold"), 2))
    return items


@router.get("/sales-deals/{pid}/deals/starred")
def sd_starred_leads(pid: str):
    _sd_get_project(pid)
    _, data_path, _ = _sd_project_paths(pid)
    leads = _sd_load_deals(data_path)
    return [l for l in leads.values() if l.get("starred")]


@router.patch("/sales-deals/{pid}/deals/{lid}")
def sd_update_lead(pid: str, lid: str, data: dict):
    _sd_get_project(pid)
    _, data_path, _ = _sd_project_paths(pid)
    leads = _sd_load_deals(data_path)
    if lid not in leads:
        raise HTTPException(404, "Deal not found")
    for field in ("status", "notes", "starred"):
        if field in data:
            leads[lid][field] = data[field]
    _sd_save_deals(data_path, leads)
    return leads[lid]


@router.delete("/sales-deals/{pid}/deals/{lid}", status_code=204)
def sd_delete_lead(pid: str, lid: str):
    _sd_get_project(pid)
    _, data_path, _ = _sd_project_paths(pid)
    leads = _sd_load_deals(data_path)
    if lid not in leads:
        raise HTTPException(404, "Deal not found")
    del leads[lid]
    _sd_save_deals(data_path, leads)


@router.post("/sales-deals/{pid}/deals/manual")
async def sd_add_manual_lead(pid: str, body: dict):
    """
    Look up a company by name, qualify it against the project ICP via Ollama,
    and add it to the leads list if it passes the save_min threshold.
    If it fails the threshold, return the scored result anyway so the UI can
    show the user *why* it was skipped and offer a force-add option.
    """
    import hashlib as _hashlib
    import datetime as _dt
    import requests as _requests

    company_name = (body.get("search_query") or body.get("company_name") or "").strip()
    force_add    = bool(body.get("force_add", False))
    if not company_name:
        raise HTTPException(400, "search_query or company_name is required")

    _sd_get_project(pid)
    cfg_path, data_path, _ = _sd_project_paths(pid)
    if not cfg_path.exists():
        raise HTTPException(400, "Project not configured yet")

    with open(cfg_path) as f:
        cfg = json.load(f)

    # ── Serper key: process env, then repo `.env`, then `sales-deal-agent/.env`
    serper_key = os.environ.get("SERPER_API_KEY", "").strip()
    if not serper_key:
        for path in (SD_DIR.parent / ".env", SD_DIR / ".env"):
            v = (_sd_parse_env_file(path).get("SERPER_API_KEY") or "").strip()
            if v:
                serper_key = v
                break

    # ── Search for the company via Serper ────────────────────────────────────
    search_geo = cfg.get("search_geo", "in")
    snippets: list[dict] = []

    if serper_key:
        for query, endpoint in [
            (f'"{company_name}" site:linkedin.com/company', "search"),
            (f'"{company_name}"', "news"),
            (f'"{company_name}"', "search"),
        ]:
            try:
                r = _requests.post(
                    f"https://google.serper.dev/{endpoint}",
                    headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
                    json={"q": query, "num": 3, "gl": search_geo},
                    timeout=10,
                )
                r.raise_for_status()
                data = r.json()
                items = data.get("organic", data.get("news", []))
                for item in items[:3]:
                    snippets.append({
                        "title":   item.get("title", ""),
                        "url":     item.get("link", ""),
                        "snippet": item.get("snippet", ""),
                    })
                if snippets:
                    break
            except Exception:
                pass
    else:
        # No Serper key — create a stub result so Ollama can still try to score it
        snippets = [{"title": company_name, "url": "", "snippet": f"Manual lookup: {company_name}"}]

    # Use the best snippet (first one found)
    best = snippets[0] if snippets else {"title": company_name, "url": "", "snippet": ""}

    # ── Build qualifier prompt (mirrors agent.py logic) ───────────────────────
    schema      = cfg.get("result_schema", {})
    thresholds  = cfg.get("score_thresholds", {})
    hot_min     = thresholds.get("hot_min", 8)
    warm_min    = thresholds.get("warm_min", 5)
    save_min    = thresholds.get("save_min", 4)
    lead_field  = schema.get("lead_name_field", "company_name")
    categories  = "|".join(schema.get("categories", []))
    geographies = "|".join(schema.get("geographies", []))
    signal_types= "|".join(schema.get("signal_types", []))
    strong      = "\n".join(f"- {s}" for s in cfg.get("strong_signals", []))
    weak        = "\n".join(f"- {s}" for s in cfg.get("weak_signals", []))
    what_we_offer = cfg.get("what_we_offer", "")
    sender      = cfg.get("sender_name", "")
    company     = cfg.get("sender_company", "")
    company_desc= cfg.get("sender_description", "")

    offer_section = f"\nWhat we are tracking:\n{what_we_offer}\n" if what_we_offer else ""
    hunt = _sd_hunt_text(cfg)
    if hunt:
        hunt_block = f"""

══ WHAT YOU ARE LOOKING FOR ══
{hunt}
Score cold if the snippet does not plausibly match this hunt.
══
"""
    else:
        hunt_block = "\n"

    # Load starred deals for context calibration
    leads_data = _sd_load_deals(data_path)
    starred_examples = [l for l in leads_data.values() if l.get("starred")]
    nk = schema.get("lead_name_field", "company_name")
    starred_ctx = ""
    if starred_examples:
        lines = "\n".join(
            f"  - {l.get(nk) or l.get('company_name','?')} | signal={l.get('signal_type','?')} | country={l.get('country','?')} | snippet={l.get('raw_snippet','')[:120]}"
            for l in starred_examples
        )
        starred_ctx = f"\n\nStarred deals (calibrate scores to similar offers):\n{lines}\n"

    qualifier_system = f"""{cfg.get("qualifier_context", "")}
{offer_section}{hunt_block}
Your job: evaluate a raw search result and decide if it is a strong SALES DEAL that matches WHAT YOU ARE LOOKING FOR.

Strong signals (score high if present):
{strong}

Weak or irrelevant signals (score low or discard):
{weak}

Return ONLY valid JSON (no markdown, no explanation):
{{
  "{lead_field}": "...",
  "company_name": "retailer or marketplace",
  "category": "{categories}",
  "country": "{geographies}",
  "fit_score": 1-10,
  "fit_reason": "Say whether this matches the hunt criteria and cite price/stock/channel",
  "priority": "hot|warm|cold",
  "outreach_email": {{
    "subject": "...",
    "body": "..."
  }},
  "source_url": "...",
  "signal_type": "{signal_types}",
  "raw_snippet": "..."
}}

fit_score guide: {hot_min}-10 = hot, {warm_min}-{hot_min - 1} = warm, 1-{warm_min - 1} = cold.
priority mirrors score: {hot_min}-10=hot, {warm_min}-{hot_min - 1}=warm, 1-{warm_min - 1}=cold.
Be strict: wrong product or region for the hunt = cold.

Notes from {sender} at {company} ({company_desc}). Do NOT invent facts.{starred_ctx}""".strip()

    user_prompt = f"""Search result to evaluate:
Title: {best['title']}
URL: {best['url']}
Snippet: {best['snippet']}

Note: This search target ({company_name}) was manually submitted by the user as a potential deal.
"""

    # ── Call Ollama ───────────────────────────────────────────────────────────
    OLLAMA_MODEL = "llama3.2"

    def call_ollama():
        return _requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "messages": [
                    {"role": "system", "content": qualifier_system},
                    {"role": "user",   "content": user_prompt},
                ],
            },
            timeout=120,
        )

    try:
        resp = await asyncio.get_event_loop().run_in_executor(None, call_ollama)
        resp.raise_for_status()
        text = resp.json()["message"]["content"].strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        qualified = json.loads(text)
    except Exception as e:
        raise HTTPException(500, f"Qualification failed: {e}")

    fit_score = qualified.get("fit_score", 0)

    # ── Decide whether to save ────────────────────────────────────────────────
    lid = _hashlib.md5((best["url"] + company_name).encode()).hexdigest()[:10]
    qualified["id"]           = lid
    qualified["found_at"]     = _dt.datetime.now().isoformat()
    qualified["status"]       = "new"
    qualified["notes"]        = ""
    qualified["channel"]      = "manual"
    qualified["channel_label"]= "Manual"

    below_threshold = fit_score < save_min and not force_add

    if below_threshold:
        # Return the scored result without saving — let the UI decide
        return {
            "saved": False,
            "below_threshold": True,
            "save_min": save_min,
            "lead": qualified,
        }

    # Save (either passes threshold, or user forced it)
    leads_data[lid] = qualified
    _sd_save_deals(data_path, leads_data)
    return {
        "saved": True,
        "below_threshold": False,
        "save_min": save_min,
        "lead": qualified,
    }


@router.get("/sales-deals/{pid}/stats")
def sd_stats(pid: str):
    _sd_get_project(pid)
    _, data_path, _ = _sd_project_paths(pid)
    leads = _sd_load_deals(data_path)
    items = list(leads.values())
    return {
        "total":     len(items),
        "new":       sum(1 for l in items if l.get("status") == "new"),
        "hot":       sum(1 for l in items if l.get("priority") == "hot"),
        "contacted": sum(1 for l in items if l.get("status") == "contacted"),
        "reviewed":  sum(1 for l in items if l.get("status") == "reviewed"),
        "starred":   sum(1 for l in items if l.get("starred")),
        "mock_search": not _sd_serper_configured(),
    }


@router.get("/sales-deals/{pid}/context")
def sd_agent_context(pid: str):
    """Return the full context the AI agent uses when qualifying deals."""
    _sd_get_project(pid)
    cfg_path, data_path, _ = _sd_project_paths(pid)
    if not cfg_path.exists():
        raise HTTPException(404, "Not configured yet")
    with open(cfg_path) as f:
        cfg = json.load(f)

    schema = cfg.get("result_schema", {})
    thresholds = cfg.get("score_thresholds", {})
    hot_min = thresholds.get("hot_min", 8)
    warm_min = thresholds.get("warm_min", 5)

    strong = "\n".join(f"- {s}" for s in cfg.get("strong_signals", []))
    weak = "\n".join(f"- {s}" for s in cfg.get("weak_signals", []))
    categories = "|".join(schema.get("categories", []))
    geographies = "|".join(schema.get("geographies", []))
    signal_types = "|".join(schema.get("signal_types", []))
    lead_field = schema.get("lead_name_field", "company_name")
    sender = cfg.get("sender_name", "")
    company = cfg.get("sender_company", "")
    company_desc = cfg.get("sender_description", "")

    what_we_offer = cfg.get("what_we_offer", "")
    offer_section = f"\nWhat we are tracking:\n{what_we_offer}\n" if what_we_offer else ""

    hunt = _sd_hunt_text(cfg)
    if hunt:
        hunt_block = f"""

══ WHAT YOU ARE LOOKING FOR (filter every result against this) ══
{hunt}
Warm/hot only if the snippet plausibly matches this hunt. Cold if wrong product, region, or no real offer — explain in fit_reason.
══
"""
    else:
        hunt_block = "\n(Set product_focus and/or ideal_customer_profile in config so the agent knows what deals to hunt.)\n"

    qualifier_prompt = f"""{cfg.get('qualifier_context', '')}
{offer_section}{hunt_block}
Your job: evaluate a raw search result and decide if it is a strong, actionable SALES DEAL.

Strong signals (score high if present):
{strong}

Weak or irrelevant signals (score low or discard):
{weak}

Return ONLY valid JSON (no markdown, no explanation):
{{
  "{lead_field}": "...",
  "company_name": "retailer or marketplace running the offer",
  "category": "{categories}",
  "country": "{geographies}",
  "fit_score": 1-10,
  "fit_reason": "Cite whether the snippet matches WHAT YOU ARE LOOKING FOR and the concrete price/stock/deal signal",
  "priority": "hot|warm|cold",
  "outreach_email": {{
    "subject": "...",
    "body": "..."
  }},
  "source_url": "...",
  "signal_type": "{signal_types}",
  "raw_snippet": "..."
}}

fit_score guide: {hot_min}-10 = hot (matches hunt + concrete deal), {warm_min}-{hot_min - 1} = warm (partial), 1-{warm_min - 1} = cold (wrong hunt or weak).
priority mirrors score: {hot_min}-10=hot, {warm_min}-{hot_min - 1}=warm, 1-{warm_min - 1}=cold.

Be strict: unrelated categories or regions = cold.

Internal note block (outreach_email) — from {sender} at {company} ({company_desc}); do not invent prices not in the snippet.""".strip()

    nk = schema.get("lead_name_field", "company_name")
    starred_leads = []
    if data_path.exists():
        try:
            with open(data_path) as f:
                all_leads = json.load(f)
            starred_leads = [
                {
                    "company_name": l.get(nk) or l.get("company_name", l.get("brand_name", "?")),
                    "signal_type": l.get("signal_type", "?"),
                    "country": l.get("country", "?"),
                    "raw_snippet": (l.get("raw_snippet", "") or "")[:150],
                    "fit_score": l.get("fit_score"),
                    "fit_reason": l.get("fit_reason", ""),
                }
                for l in all_leads.values() if l.get("starred")
            ]
        except Exception:
            pass

    starred_context = ""
    if starred_leads:
        lines = "\n".join(
            f"  - {l['company_name']} | signal={l['signal_type']} | country={l['country']} | snippet={l['raw_snippet'][:120]}"
            for l in starred_leads
        )
        starred_context = (
            f"The user has flagged these as GREAT deals (starred). "
            f"Use them to calibrate your scoring — similar offers should score higher:\n{lines}"
        )

    return {
        "config": {
            "agent_name": cfg.get("agent_name", ""),
            "sender_name": cfg.get("sender_name", ""),
            "sender_company": cfg.get("sender_company", ""),
            "sender_description": cfg.get("sender_description", ""),
            "qualifier_context": cfg.get("qualifier_context", ""),
            "ideal_customer_profile": cfg.get("ideal_customer_profile", ""),
            "what_we_offer": cfg.get("what_we_offer", ""),
            "product_focus": cfg.get("product_focus", ""),
        },
        "strong_signals": cfg.get("strong_signals", []),
        "weak_signals": cfg.get("weak_signals", []),
        "search_queries": cfg.get("search_queries", []),
        "result_schema": schema,
        "score_thresholds": thresholds,
        "qualifier_prompt": qualifier_prompt,
        "starred_leads": starred_leads,
        "starred_context": starred_context,
        "search_geo": cfg.get("search_geo", ""),
        "search_channels": cfg.get("search_channels", ["linkedin", "google", "news"]),
        "max_results_per_query": cfg.get("max_results_per_query", 5),
        "batch_size": cfg.get("batch_size", 0),
    }


@router.get("/sales-deals/{pid}/log")
def sd_log(pid: str):
    _sd_get_project(pid)
    _, _, log_path = _sd_project_paths(pid)
    if log_path.exists():
        lines = log_path.read_text().splitlines()[-50:]
        return {"log": "\n".join(lines)}
    return {"log": "No log yet."}


@router.get("/sales-deals/{pid}/status")
def sd_status(pid: str):
    """Returns current job status for this project."""
    _sd_get_project(pid)
    status = _sd_read_status(pid)
    # If the job is "running" but the PID-tracked process is gone, auto-clear it.
    # We use the status file's own timestamp — if it's been running for >30 min, mark stale.
    if status.get("state") == "running" and status.get("ts"):
        import datetime as _dt
        try:
            started = _dt.datetime.fromisoformat(status["ts"])
            age = (_dt.datetime.now() - started).total_seconds()
            if age > 1800:  # 30 minutes max
                _sd_write_status(pid, status.get("job", "run"), "done", "timed out")
                status = _sd_read_status(pid)
        except Exception:
            pass
    return status


@router.post("/sales-deals/{pid}/run")
def sd_run(pid: str):
    """Trigger a manual agent run in the background."""
    _sd_get_project(pid)
    # Reject if a job is already running
    current = _sd_read_status(pid)
    if current.get("state") == "running":
        raise HTTPException(409, f"A {current.get('job', 'job')} is already running")
    project_dir = str(_sd_project_dir(pid))
    agent_script = str(SD_DIR / "agent.py")
    venv_python = sys.executable
    env = os.environ.copy()
    _sd_merge_dotenv_into_env(env)
    try:
        _sd_write_status(pid, "run", "running", "Agent searching for deals…")
        proc = subprocess.Popen(
            [venv_python, agent_script, "--project-dir", project_dir],
            cwd=str(SD_DIR),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _sd_procs[pid] = proc
        # Background thread to mark done when process exits
        import threading
        def _watch(p, _pid):
            p.wait()
            _sd_procs.pop(_pid, None)
            # Only update status if it wasn't already set to stopped/error
            current = _sd_read_status(_pid)
            if current.get("state") == "running":
                _sd_write_status(_pid, "run", "done", "Run complete")
        threading.Thread(target=_watch, args=(proc, pid), daemon=True).start()
        return {"status": "started"}
    except Exception as e:
        _sd_write_status(pid, "run", "error", str(e))
        raise HTTPException(500, f"Failed to start agent: {e}")


@router.get("/sales-deals/{pid}/search-history")
def sd_search_history(pid: str):
    """Return the search history for this project."""
    _sd_get_project(pid)
    history_path = _sd_project_dir(pid) / "data" / "search_history.json"
    if not history_path.exists():
        return {"queries": {}, "total": 0}
    try:
        with open(history_path) as f:
            history = json.load(f)
        return {"queries": history, "total": len(history)}
    except Exception:
        return {"queries": {}, "total": 0}


@router.delete("/sales-deals/{pid}/search-history", status_code=204)
def sd_clear_search_history(pid: str):
    """Clear search history so all queries run fresh on next agent run."""
    _sd_get_project(pid)
    history_path = _sd_project_dir(pid) / "data" / "search_history.json"
    if history_path.exists():
        history_path.unlink()
    return


@router.post("/sales-deals/{pid}/stop")
def sd_stop(pid: str):
    """Stop a running agent for this project."""
    _sd_get_project(pid)
    proc = _sd_procs.pop(pid, None)
    if proc is not None:
        try:
            proc.terminate()
        except Exception:
            pass
    _sd_write_status(pid, "run", "done", "Stopped by user")
    return {"status": "stopped"}


@router.post("/sales-deals/{pid}/cleanup")
def sd_cleanup(pid: str):
    """Run the AI cleanup agent (dedup + archive removal) in the foreground and return a summary."""
    _sd_get_project(pid)
    current = _sd_read_status(pid)
    if current.get("state") == "running":
        raise HTTPException(409, f"A {current.get('job', 'job')} is already running")
    project_dir   = str(_sd_project_dir(pid))
    cleanup_script = str(SD_DIR / "cleanup.py")
    venv_python   = sys.executable
    env = os.environ.copy()
    _sd_merge_dotenv_into_env(env)
    _sd_write_status(pid, "cleanup", "running", "Scanning for duplicates…")
    try:
        result = subprocess.run(
            [venv_python, cleanup_script, "--project-dir", project_dir],
            cwd=str(SD_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            _sd_write_status(pid, "cleanup", "error", result.stderr[:200])
            raise HTTPException(500, f"Cleanup failed: {result.stderr[:500]}")
        summary_path = Path(project_dir) / "data" / "cleanup_summary.json"
        if summary_path.exists():
            with open(summary_path) as f:
                summary = json.load(f)
        else:
            summary = {"total_removed": 0, "remaining": 0}
        detail = f"Removed {summary.get('total_removed', 0)} duplicates, {summary.get('remaining', 0)} deals remain"
        _sd_write_status(pid, "cleanup", "done", detail)
        return summary
    except subprocess.TimeoutExpired:
        _sd_write_status(pid, "cleanup", "error", "Timed out")
        raise HTTPException(504, "Cleanup timed out")
    except HTTPException:
        raise
    except Exception as e:
        _sd_write_status(pid, "cleanup", "error", str(e))
        raise HTTPException(500, f"Failed to run cleanup: {e}")


@router.patch("/sales-deals/{pid}/config")
def sd_patch_config(pid: str, payload: dict):
    """Patch specific fields in a project's config.json."""
    _sd_get_project(pid)
    cfg_path, _, _ = _sd_project_paths(pid)
    if not cfg_path.exists():
        raise HTTPException(404, "Config not found. Complete onboarding first.")
    with open(cfg_path) as f:
        cfg = json.load(f)
    cfg.update(payload)
    with open(cfg_path, "w") as f:
        json.dump(cfg, f, indent=2)
    return {"ok": True}


@router.post("/sales-deals/{pid}/refine-queries")
async def sd_refine_queries(pid: str):
    """
    Use Ollama to suggest query refinements based on starred + manually-added leads.
    Returns a proposed new search_queries list with a diff vs the current one.
    Does NOT apply changes — the frontend shows a review UI first.
    """
    import requests as _requests

    _sd_get_project(pid)
    cfg_path, data_path, _ = _sd_project_paths(pid)
    if not cfg_path.exists():
        raise HTTPException(400, "Project not configured yet")

    with open(cfg_path) as f:
        cfg = json.load(f)

    leads_data = _sd_load_deals(data_path)
    reference_leads = [
        l for l in leads_data.values()
        if l.get("starred") or l.get("channel") == "manual"
    ]

    if not reference_leads:
        raise HTTPException(400, "No starred or manually-added deals to refine from. Star some good deals first.")

    current_queries_json = json.dumps(cfg.get("search_queries", []), indent=2, ensure_ascii=False)
    hunt = _sd_hunt_text(cfg) or "(product_focus / ICP not set — infer from reference deals)"
    strong = "\n".join(f"  - {s}" for s in cfg.get("strong_signals", []))
    signal_types = json.dumps(cfg.get("result_schema", {}).get("signal_types", []), ensure_ascii=False)
    geographies = json.dumps(cfg.get("result_schema", {}).get("geographies", []), ensure_ascii=False)
    search_geo = cfg.get("search_geo", "")
    nk = cfg.get("result_schema", {}).get("lead_name_field", "company_name")

    ref_lines = "\n".join(
        f"  - {l.get(nk) or l.get('company_name', '?')} | category={l.get('category', '?')} | country={l.get('country', '?')} | signal={l.get('signal_type', '?')} | score={l.get('fit_score', '?')} | reason={l.get('fit_reason', '')[:100]} | snippet={l.get('raw_snippet', '')[:120]}"
        for l in reference_leads
    )

    system_prompt = f"""You are a retail deal-hunting strategist refining a search query set.

CONTEXT — what the user is looking for:
{hunt}

Strong signals:
{strong}
- Target geographies: {geographies}
- Search geo setting: {search_geo}
- Valid signal types: {signal_types}

REFERENCE DEALS (starred or manually added — good examples):
{ref_lines}

CURRENT SEARCH QUERIES:
{current_queries_json}

TASK:
Analyse the reference deals and the hunt criteria. Rewrite search_queries so Google/news searches surface more matching product deals (retailers, prices, promos, SKUs):
1. Add NEW queries that include product names, price terms, marketplace names, and geo where relevant
2. Tighten generic queries — include category + region + deal language (sale, discount, lowest price)
3. Drop queries that cannot find commerce/deal snippets (mark dropped in output JSON as before)
4. Keep queries that still align with the hunt

Rules for queries:
- 5-12 words, like a real Google search for a shopper or pricing analyst
- Include product/category, brand or marketplace when possible, and geography
- No vague single-word queries
- Aim for 4-6 queries per signal group
- Only use signal types from the valid list above

Output ONLY this JSON (no markdown, no explanation):
{{
  "proposed": [
    {{"signal": "signal_type_here", "queries": ["query 1", "query 2", ...]}}
  ],
  "dropped": ["list of query strings that were removed"],
  "added": ["list of query strings that are new"],
  "reasoning": "2-3 sentence summary of what changed and why, based on the hunt criteria and reference deals"
}}"""

    # ── Call Ollama ───────────────────────────────────────────────────────────
    OLLAMA_MODEL = "llama3.2"

    def call_ollama():
        return _requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "messages": [{"role": "user", "content": system_prompt}],
            },
            timeout=180,
        )

    try:
        resp = await asyncio.get_event_loop().run_in_executor(None, call_ollama)
        resp.raise_for_status()
        text = resp.json()["message"]["content"].strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
    except Exception as e:
        raise HTTPException(500, f"Query refinement failed: {e}")

    return {
        "current":  cfg.get("search_queries", []),
        "proposed": result.get("proposed", []),
        "dropped":  result.get("dropped", []),
        "added":    result.get("added", []),
        "reasoning": result.get("reasoning", ""),
        "reference_count": len(reference_leads),
    }


@router.post("/sales-deals/{pid}/refine-queries/apply")
def sd_apply_refined_queries(pid: str, body: dict):
    """
    Apply a proposed search_queries list from the refine step.
    Clears search history only for new/changed queries so existing ones aren't re-run.
    """
    _sd_get_project(pid)
    cfg_path, _, _ = _sd_project_paths(pid)
    if not cfg_path.exists():
        raise HTTPException(400, "Project not configured yet")

    proposed = body.get("proposed")
    added    = body.get("added", [])
    if not proposed:
        raise HTTPException(400, "proposed queries required")

    with open(cfg_path) as f:
        cfg = json.load(f)

    cfg["search_queries"] = proposed
    with open(cfg_path, "w") as f:
        json.dump(cfg, f, indent=2)

    # Clear history entries only for new/added queries so we don't re-run unchanged ones
    history_path = _sd_project_dir(pid) / "data" / "search_history.json"
    if history_path.exists() and added:
        try:
            with open(history_path) as f:
                history = json.load(f)
            # History keys are "{channel}::{query}" — remove entries whose query part is new
            added_set = set(q.strip().lower() for q in added)
            keys_to_remove = [
                k for k in history
                if any(q in k.lower() for q in added_set)
            ]
            for k in keys_to_remove:
                del history[k]
            with open(history_path, "w") as f:
                json.dump(history, f, indent=2)
        except Exception:
            pass  # Non-fatal — worst case the new queries just run again

    return {"ok": True, "applied": len(proposed)}


@router.get("/sales-deals/{pid}/config/status")
def sd_config_status(pid: str):
    """Returns whether a config exists for this project."""
    _sd_get_project(pid)
    cfg_path, _, _ = _sd_project_paths(pid)
    return {"configured": cfg_path.exists()}


@router.get("/sales-deals/{pid}/config")
def sd_config_get(pid: str):
    _sd_get_project(pid)
    cfg_path, _, _ = _sd_project_paths(pid)
    if not cfg_path.exists():
        raise HTTPException(404, "Not configured yet")
    with open(cfg_path) as f:
        return json.load(f)


@router.post("/sales-deals/{pid}/config")
def sd_config_save(pid: str, data: dict):
    _sd_get_project(pid)
    cfg_path, _, _ = _sd_project_paths(pid)
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cfg_path, "w") as f:
        json.dump(data, f, indent=2)
    # Clear search history so new config gets fresh searches
    history_path = _sd_project_dir(pid) / "data" / "search_history.json"
    if history_path.exists():
        history_path.unlink()
    return {"ok": True}


@router.websocket("/sales-deals/ws/onboard")
async def sd_onboard(ws: WebSocket, project_id: str = ""):
    """
    Onboarding chat for a specific project.
    project_id must be passed as a query parameter: ?project_id=<pid>
    Messages: {type: "user"|"agent"|"config_ready"|"error", content: ...}
    """
    import requests as _requests

    await ws.accept()

    if not project_id:
        await ws.send_text(json.dumps({"type": "error", "content": "project_id query parameter is required"}))
        await ws.close()
        return

    try:
        _sd_get_project(project_id)
    except HTTPException:
        await ws.send_text(json.dumps({"type": "error", "content": f"Project not found: {project_id}"}))
        await ws.close()
        return

    cfg_path, _, _ = _sd_project_paths(project_id)

    OLLAMA_MODEL = "llama3.2"

    def ollama_chat(messages: list, system: str) -> str:
        payload = {
            "model": OLLAMA_MODEL,
            "stream": False,
            "messages": [{"role": "system", "content": system}] + messages,
        }
        resp = _requests.post(OLLAMA_URL, json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()

    SYSTEM = """You are a setup assistant for a Sales Deal tracking agent (retail/commerce offers).
Your job is to gather enough information to configure the agent for this user's products and markets.

Ask questions ONE AT A TIME in a natural conversation. Cover these areas:
1. What product category or SKU are they tracking deals for?
2. What regions or channels matter (online marketplaces, retail chains, D2C)?
3. What counts as a strong deal signal (price drop %, bundle, clearance, festive sale)?
4. What should be ignored (used goods, wrong geography, fake prices)?
5. Who is the internal owner — name, team, company?

Once you have enough detail (usually 5-7 exchanges), respond with ONLY the JSON block shown below — nothing before or after it.

CRITICAL RULE: If the user says ANYTHING like "go ahead", "generate", "done", "create it", "proceed", "looks good",
"that's enough", "force generate", or sends [FORCE_GENERATE] — you MUST immediately output the <CONFIG>...</CONFIG>
block below with sensible defaults for anything not yet discussed. NEVER respond with prose in these cases.
Do NOT ask another question. Do NOT summarise. Output the block ONLY.

<CONFIG>
{
  "agent_name": "...",
  "sender_name": "...",
  "sender_company": "...",
  "sender_description": "role | one-line company description",
  "qualifier_context": "2-3 sentence paragraph: what deal types to find and how to score snippets. Written for an AI evaluating search results.",
  "ideal_customer_profile": "Region & buyer context (where deals must be relevant).",
  "what_we_offer": "What the team does with good deal alerts.",
  "product_focus": "REQUIRED: exact products, categories, price band, brands, or SKUs you want deals for (e.g. 'Sony WH-1000XM5 under ₹25000 in India').",
  "strong_signals": [
    "Concrete deal signal — e.g. explicit discount %, flash sale, lowest price, in stock",
    "..."
  ],
  "weak_signals": [
    "What looks relevant but should score low or be ignored",
    "..."
  ],
  "result_schema": {
    "lead_name_field": "product_name",
    "categories": ["..."],
    "geographies": ["..."],
    "signal_types": ["snake_case_signal_name", "..."]
  },
  "score_thresholds": {
    "hot_min": 8,
    "warm_min": 5,
    "save_min": 4
  },
  "search_queries": [
    {
      "signal": "signal_name",
      "queries": ["specific search query", "another specific query", "..."]
    }
  ],
  "search_channels": ["linkedin", "google", "news"],
  "max_results_per_query": 5,
  "search_geo": "us"
}
</CONFIG>

Rules for search_queries:
- Each query must help find PRODUCT DEALS matching product_focus (price, retailer, marketplace, promo).
- Include product names, categories, "sale", "discount", "lowest price", marketplace names (Amazon, Flipkart), and geography.
- Bad: "electronics India". Good: "wireless earbuds lowest price Flipkart Amazon India 2026".
- Generate 3-5 signal groups (e.g. price_drop, clearance, marketplace_promo), each with 4-6 queries.

For search_channels — for retail deals prefer:
  "google"     → broad product/deal search (usually first)
  "news"       → sale announcements
  "reddit"     → deal threads
  "instagram" / "facebook" → brand promos (optional)
  "linkedin"   → rarely useful for consumer deals; omit unless B2B procurement

Pick 2-4 channels. Example: ["google", "news", "reddit"]
"""

    history: list[dict] = []

    # Kick off the conversation
    init_msg = "Hello, I'd like to set up the Sales Deal agent for my products."
    opening_text = await asyncio.get_event_loop().run_in_executor(
        None, lambda: ollama_chat([{"role": "user", "content": init_msg}], SYSTEM)
    )
    history.append({"role": "user",      "content": init_msg})
    history.append({"role": "assistant", "content": opening_text})
    await ws.send_text(json.dumps({"type": "agent", "content": opening_text}))

    FORCE_TRIGGER_WORDS = {"[force_generate]"}

    async def _save_cfg(raw_json: str):
        """Parse, persist, and broadcast the config. Returns cfg dict or raises."""
        cfg = json.loads(raw_json)
        cfg_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cfg_path, "w") as f:
            json.dump(cfg, f, indent=2)
        await ws.send_text(json.dumps({"type": "config_ready", "content": cfg}))
        return cfg

    async def _force_generate():
        """Keep asking the LLM until it produces valid JSON (up to 3 attempts)."""
        force_prompt = (
            "Generate the complete configuration JSON right now. "
            "Use sensible defaults for any fields not yet discussed. "
            "Output ONLY the <CONFIG>...</CONFIG> block — no other text."
        )
        for attempt in range(3):
            h = list(history)
            h.append({"role": "user", "content": force_prompt})
            gen_reply = await asyncio.get_event_loop().run_in_executor(
                None, lambda: ollama_chat(h, SYSTEM)
            )
            history.append({"role": "user",      "content": force_prompt})
            history.append({"role": "assistant", "content": gen_reply})

            if "<CONFIG>" in gen_reply and "</CONFIG>" in gen_reply:
                raw_cfg = gen_reply.split("<CONFIG>")[1].split("</CONFIG>")[0].strip()
                try:
                    await _save_cfg(raw_cfg)
                    return True
                except json.JSONDecodeError as e:
                    force_prompt = (
                        f"Syntax error in your JSON: {e}. "
                        "Output ONLY the corrected <CONFIG>...</CONFIG> block."
                    )
                    continue
            # LLM replied in prose again — push harder next loop
            force_prompt = (
                "You must output the <CONFIG>...</CONFIG> block NOW. "
                "No explanations, no questions — just the JSON block."
            )
        # All attempts failed
        await ws.send_text(json.dumps({
            "type": "agent",
            "content": (
                "I'm having trouble generating the config automatically. "
                "Please click 'Set up manually' to fill in the details directly."
            ),
        }))
        return False

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            user_text = msg.get("content", "").strip()
            force = msg.get("force", False)
            if not user_text:
                continue

            # Force-generate path: skip normal LLM reply, go straight to config generation
            if force or any(t in user_text.lower() for t in FORCE_TRIGGER_WORDS):
                history.append({"role": "user", "content": user_text})
                await _force_generate()
                continue

            history.append({"role": "user", "content": user_text})

            reply = await asyncio.get_event_loop().run_in_executor(
                None, lambda: ollama_chat(history, SYSTEM)
            )
            history.append({"role": "assistant", "content": reply})

            if "<CONFIG>" in reply and "</CONFIG>" in reply:
                raw_cfg = reply.split("<CONFIG>")[1].split("</CONFIG>")[0].strip()
                try:
                    await _save_cfg(raw_cfg)
                except json.JSONDecodeError:
                    # JSON malformed — hand off to the force-generate retry loop
                    await _force_generate()
            else:
                await ws.send_text(json.dumps({"type": "agent", "content": reply}))

    except WebSocketDisconnect:
        pass


@router.websocket("/sales-deals/ws/correct")
async def sd_correct(ws: WebSocket, project_id: str = ""):
    """
    Lead correction chat for a specific project.
    project_id must be passed as a query parameter: ?project_id=<pid>
    Messages: {type: "user"|"agent"|"config_ready"|"error", content: ...}
    """
    import requests as _requests

    await ws.accept()

    if not project_id:
        await ws.send_text(json.dumps({"type": "error", "content": "project_id query parameter is required"}))
        await ws.close()
        return

    try:
        _sd_get_project(project_id)
    except HTTPException:
        await ws.send_text(json.dumps({"type": "error", "content": f"Project not found: {project_id}"}))
        await ws.close()
        return

    cfg_path, data_path, _ = _sd_project_paths(project_id)

    OLLAMA_MODEL = "llama3.2"

    def ollama_chat(messages: list, system: str) -> str:
        payload = {
            "model": OLLAMA_MODEL,
            "stream": False,
            "messages": [{"role": "system", "content": system}] + messages,
        }
        resp = _requests.post(OLLAMA_URL, json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()

    try:
        with open(cfg_path) as f:
            current_cfg = json.load(f)
    except Exception:
        await ws.send_text(json.dumps({"type": "error", "content": "No config found. Please complete onboarding first."}))
        return

    nk = current_cfg.get("result_schema", {}).get("lead_name_field", "company_name")

    leads_sample = []
    starred_leads = []
    if data_path.exists():
        try:
            with open(data_path) as f:
                all_leads = json.load(f)
            leads_list = list(all_leads.values())
            starred_leads = [l for l in leads_list if l.get("starred")]
            leads_sample = leads_list[:6]
        except Exception:
            pass

    def _deal_label(l: dict) -> str:
        return str(l.get(nk) or l.get("company_name") or l.get("product_name") or "?")

    leads_summary = "\n".join([
        f"- {_deal_label(l)} | score={l.get('fit_score','?')} | signal={l.get('signal_type','?')} | country={l.get('country','?')} | reason={l.get('fit_reason','?')[:80]}"
        for l in leads_sample
    ]) or "No deals generated yet."

    starred_summary = "\n".join([
        f"- {_deal_label(l)} | signal={l.get('signal_type','?')} | country={l.get('country','?')} | snippet={l.get('raw_snippet','')[:120]} | reason={l.get('fit_reason','?')[:100]}"
        for l in starred_leads
    ]) if starred_leads else ""

    current_queries = "\n".join([
        f"  [{g['signal']}]: " + " / ".join(g['queries'])
        for g in current_cfg.get("search_queries", [])
    ])

    starred_section = f"""
The user starred these deals ⭐ — find MORE offers like these:
{starred_summary}

Use language, retailers, price signals, and product types from these examples when adjusting queries or signals.
""" if starred_summary else ""

    icp = current_cfg.get("ideal_customer_profile", "")
    what_we_offer = current_cfg.get("what_we_offer", "")
    product_focus = current_cfg.get("product_focus", "")

    # Pre-escape for safe embedding in the f-string CONFIG template
    qualifier_context_esc = current_cfg.get("qualifier_context", "").replace('"', '\\"')
    icp_esc = icp.replace('"', '\\"')
    what_we_offer_esc = what_we_offer.replace('"', '\\"')
    product_focus_esc = product_focus.replace('"', '\\"')

    # Serialise current values so the LLM can carry them forward verbatim
    current_strong  = json.dumps(current_cfg.get("strong_signals", []), ensure_ascii=False)
    current_weak    = json.dumps(current_cfg.get("weak_signals", []), ensure_ascii=False)
    current_cats    = json.dumps(current_cfg.get("result_schema", {}).get("categories", []), ensure_ascii=False)
    current_geos    = json.dumps(current_cfg.get("result_schema", {}).get("geographies", []), ensure_ascii=False)
    current_sigs    = json.dumps(current_cfg.get("result_schema", {}).get("signal_types", []), ensure_ascii=False)
    current_queries_json  = json.dumps(current_cfg.get("search_queries", []), indent=4, ensure_ascii=False)
    current_thresholds    = json.dumps(current_cfg.get("score_thresholds", {"hot_min": 8, "warm_min": 5, "save_min": 4}), ensure_ascii=False)
    current_channels      = json.dumps(current_cfg.get("search_channels", ["linkedin", "google", "news"]), ensure_ascii=False)

    SYSTEM = f"""You are a deal-hunting strategist making targeted corrections to a Sales Deal agent's config.

CURRENT CONFIG (your baseline — preserve everything the user has NOT complained about):
- Qualifier context: {current_cfg.get('qualifier_context', '')}
- Product focus (what deals to hunt): {product_focus}
- Ideal customer profile: {icp}
- What we offer: {what_we_offer}
- Sender: {current_cfg.get('sender_name', '')} at {current_cfg.get('sender_company', '')} ({current_cfg.get('sender_description', '')})
- Strong signals: {current_strong}
- Weak signals: {current_weak}
- Geographies: {current_geos}
- Categories: {current_cats}
- Signal types: {current_sigs}
- Score thresholds: {current_thresholds}
- Search channels (priority order): {current_channels}
- Search geo: {current_cfg.get('search_geo', '')}
- Max results per query: {current_cfg.get('max_results_per_query', 5)}

Current search queries:
{current_queries}

Sample of deals generated so far:
{leads_summary}
{starred_section}

INSTRUCTIONS:
- The user is describing a SPECIFIC problem with the current deals — do NOT rewrite everything.
- Only change the fields that are directly relevant to the user's feedback. Carry forward all other values exactly as they are above.
- If the user says queries are too generic → update search_queries only.
- If the user says wrong geography → update geographies and search_queries only.
- If the user says wrong type of offers or retailers → update strong_signals, weak_signals, and search_queries.
- If the user says context is wrong → update qualifier_context, product_focus, and/or ideal_customer_profile.
- If the user says wrong channels or wants to add/change channels → update search_channels only.
- You may ask AT MOST ONE short clarifying question — only if genuinely needed. Then output the config.
- Make search queries SPECIFIC — product/category, price terms, marketplace, geo. Bad: "electronics India". Good: "Sony headphones lowest price Amazon India 2026".
- Available channels: "linkedin", "reddit", "instagram", "facebook", "news", "google". Order by priority (most likely to yield signal first).

When ready, output ONLY this exact block (nothing before or after):

<CONFIG>
{{
  "agent_name": "{current_cfg.get('agent_name', '')}",
  "sender_name": "{current_cfg.get('sender_name', '')}",
  "sender_company": "{current_cfg.get('sender_company', '')}",
  "sender_description": "{current_cfg.get('sender_description', '')}",
  "qualifier_context": "{qualifier_context_esc}",
  "ideal_customer_profile": "{icp_esc}",
  "what_we_offer": "{what_we_offer_esc}",
  "product_focus": "{product_focus_esc}",
  "strong_signals": {current_strong},
  "weak_signals": {current_weak},
  "result_schema": {{
    "lead_name_field": "{current_cfg.get('result_schema', {}).get('lead_name_field', 'product_name')}",
    "categories": {current_cats},
    "geographies": {current_geos},
    "signal_types": {current_sigs}
  }},
  "score_thresholds": {current_thresholds},
  "search_queries": {current_queries_json},
  "search_channels": {current_channels},
  "max_results_per_query": {current_cfg.get('max_results_per_query', 5)},
  "search_geo": "{current_cfg.get('search_geo', '')}"
}}
</CONFIG>

The values above are the DEFAULTS. Only edit the fields the user's feedback requires. Everything else stays exactly as shown.
"""

    history: list[dict] = []

    # Wait for the user's first message — no LLM round-trip on connect
    await ws.send_text(json.dumps({
        "type": "agent",
        "content": "Got it — what's wrong with the current deals? I'll make targeted corrections while keeping everything that's working.",
    }))

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            user_text = msg.get("content", "").strip()
            if not user_text:
                continue

            history.append({"role": "user", "content": user_text})

            try:
                h = list(history)  # snapshot to avoid closure mutation issues
                reply = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(
                        None, lambda: ollama_chat(h, SYSTEM)
                    ),
                    timeout=180,
                )
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({
                    "type": "agent",
                    "content": "The model took too long to respond. Please try again with a shorter message.",
                }))
                continue
            except Exception as e:
                await ws.send_text(json.dumps({
                    "type": "agent",
                    "content": f"Error calling the model: {e}. Is Ollama running?",
                }))
                continue

            history.append({"role": "assistant", "content": reply})

            if "<CONFIG>" in reply and "</CONFIG>" in reply:
                raw_cfg = reply.split("<CONFIG>")[1].split("</CONFIG>")[0].strip()
                try:
                    new_cfg = json.loads(raw_cfg)
                    with open(cfg_path, "w") as f:
                        json.dump(new_cfg, f, indent=2)
                    await ws.send_text(json.dumps({"type": "config_ready", "content": new_cfg}))
                except json.JSONDecodeError as parse_err:
                    # Auto-retry: ask the LLM to fix its own malformed JSON
                    fix_prompt = (
                        f"The JSON you produced has a syntax error: {parse_err}. "
                        "Please output ONLY the corrected JSON between <CONFIG> and </CONFIG> tags — "
                        "no other text, no markdown fences."
                    )
                    history.append({"role": "user", "content": fix_prompt})
                    retry_reply = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: ollama_chat(history, SYSTEM)
                    )
                    history.append({"role": "assistant", "content": retry_reply})
                    if "<CONFIG>" in retry_reply and "</CONFIG>" in retry_reply:
                        raw_cfg2 = retry_reply.split("<CONFIG>")[1].split("</CONFIG>")[0].strip()
                        try:
                            new_cfg = json.loads(raw_cfg2)
                            with open(cfg_path, "w") as f:
                                json.dump(new_cfg, f, indent=2)
                            await ws.send_text(json.dumps({"type": "config_ready", "content": new_cfg}))
                        except json.JSONDecodeError:
                            await ws.send_text(json.dumps({
                                "type": "agent",
                                "content": "I'm having repeated trouble generating valid JSON. Please try rephrasing your feedback.",
                            }))
                    else:
                        await ws.send_text(json.dumps({"type": "agent", "content": retry_reply}))
            else:
                await ws.send_text(json.dumps({"type": "agent", "content": reply}))

    except WebSocketDisconnect:
        pass
