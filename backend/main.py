from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Dict, List, Optional

import aiofiles
import pandas as pd
from fastapi import (
    FastAPI, File, HTTPException, UploadFile, WebSocket,
    WebSocketDisconnect, Depends
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import agent
from agent import CATEGORY_TAXONOMY
import parser as inv_parser
from database import get_db, init_db, save_inventory
from schemas import UploadResponse, SheetInfo

# ─── Pollen BD Agent paths ─────────────────────────────────────────────────────
POLLEN_DIR           = Path(__file__).parent.parent / "pollen-bd-agent"
POLLEN_PROJECTS_DIR  = POLLEN_DIR / "projects"
POLLEN_PROJECTS_FILE = POLLEN_DIR / "projects.json"


# ─── Pollen Project Helpers ────────────────────────────────────────────────────

def _pollen_project_dir(pid: str) -> Path:
    return POLLEN_PROJECTS_DIR / pid


def _pollen_project_paths(pid: str):
    """Returns (config_path, data_path, log_path) for a project."""
    d = _pollen_project_dir(pid)
    return d / "config.json", d / "data" / "leads.json", d / "data" / "agent.log"


def _pollen_load_projects() -> list:
    if POLLEN_PROJECTS_FILE.exists():
        with open(POLLEN_PROJECTS_FILE) as f:
            return json.load(f)
    return []


def _pollen_save_projects(projects: list):
    POLLEN_PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(POLLEN_PROJECTS_FILE, "w") as f:
        json.dump(projects, f, indent=2)


def _pollen_migrate_legacy():
    """If old single-project config.json exists, migrate it into projects/default/."""
    import shutil, datetime as _dt
    old_config = POLLEN_DIR / "config.json"
    if not old_config.exists():
        return
    projects = _pollen_load_projects()
    if any(p["id"] == "default" for p in projects):
        return
    default_dir = POLLEN_PROJECTS_DIR / "default"
    (default_dir / "data").mkdir(parents=True, exist_ok=True)
    shutil.copy2(old_config, default_dir / "config.json")
    old_data = POLLEN_DIR / "data" / "leads.json"
    if old_data.exists():
        shutil.copy2(old_data, default_dir / "data" / "leads.json")
    old_log = POLLEN_DIR / "data" / "agent.log"
    if old_log.exists():
        shutil.copy2(old_log, default_dir / "data" / "agent.log")
    projects.append({
        "id": "default",
        "name": "Default",
        "created_at": _dt.datetime.now().isoformat(),
    })
    _pollen_save_projects(projects)
    old_config.rename(POLLEN_DIR / "config.json.migrated")


def _pollen_load_leads(data_path: Path) -> dict:
    if data_path.exists():
        with open(data_path) as f:
            return json.load(f)
    return {}


def _pollen_save_leads(data_path: Path, leads: dict):
    data_path.parent.mkdir(parents=True, exist_ok=True)
    with open(data_path, "w") as f:
        json.dump(leads, f, indent=2)


def _pollen_status_path(pid: str) -> Path:
    return _pollen_project_dir(pid) / "data" / "status.json"


def _pollen_write_status(pid: str, job: str, state: str, detail: str = ""):
    import datetime as _dt
    path = _pollen_status_path(pid)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump({
            "job":    job,    # "run" | "cleanup" | "idle"
            "state":  state,  # "running" | "done" | "error"
            "detail": detail,
            "ts":     _dt.datetime.now().isoformat(),
        }, f)


def _pollen_read_status(pid: str) -> dict:
    path = _pollen_status_path(pid)
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {"job": "idle", "state": "done", "detail": "", "ts": ""}


# Registry of running agent subprocesses keyed by project id
_pollen_procs: Dict[str, "subprocess.Popen[bytes]"] = {}


def _pollen_get_project(pid: str) -> dict:
    projects = _pollen_load_projects()
    for p in projects:
        if p["id"] == pid:
            return p
    raise HTTPException(404, f"Project '{pid}' not found")

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)
CONTEXT_MEMORY_PATH = Path("context_memory.json")

app = FastAPI(title="Inventory Parser API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()
    _pollen_migrate_legacy()


# ─── REST Endpoints ────────────────────────────────────────────────────────────

@app.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    allowed = {".csv", ".xlsx", ".xls", ".xlsm"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Allowed: {', '.join(allowed)}")

    file_id = str(uuid.uuid4())
    dest = UPLOAD_DIR / f"{file_id}{ext}"

    async with aiofiles.open(dest, "wb") as f:
        content = await file.read()
        await f.write(content)

    try:
        parsed = inv_parser.detect_and_parse(str(dest))
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, f"Could not parse file: {e}")

    meta = parsed.pop("_meta", {})
    sheet_names = meta.get("sheet_names", list(parsed.keys()))

    sheets = {name: SheetInfo(**info) for name, info in parsed.items()}

    return UploadResponse(
        file_id=file_id,
        original_filename=file.filename,
        file_type=meta.get("file_type", ext.lstrip(".")),
        sheet_count=meta.get("sheet_count", len(sheets)),
        sheet_names=sheet_names,
        sheets=sheets,
    )


@app.get("/download/{file_id}")
async def download_file(file_id: str):
    for ext in (".csv", ".xlsx"):
        path = OUTPUT_DIR / f"{file_id}_normalized{ext}"
        if path.exists():
            media = "text/csv" if ext == ".csv" else (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
            return FileResponse(str(path), media_type=media, filename=path.name)
    raise HTTPException(404, "No output file found for this session.")


@app.get("/download/{file_id}/clean-template")
async def download_clean_template_file(file_id: str):
    path = OUTPUT_DIR / f"{file_id}_clean_template.csv"
    if not path.exists():
        raise HTTPException(404, "No clean template output file found for this session.")
    return FileResponse(str(path), media_type="text/csv", filename=path.name)


# ─── Pollen BD Agent API ───────────────────────────────────────────────────────

# ── Project Management ────────────────────────────────────────────────────────

@app.get("/pollen/projects")
def pollen_list_projects():
    """List all BD agent projects with their configured status."""
    projects = _pollen_load_projects()
    result = []
    for p in projects:
        cfg_path, _, _ = _pollen_project_paths(p["id"])
        result.append({**p, "configured": cfg_path.exists()})
    return result


@app.post("/pollen/projects", status_code=201)
def pollen_create_project(data: dict):
    """Create a new BD agent project."""
    import uuid, datetime as _dt
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Project name is required")
    pid = str(uuid.uuid4())[:8]
    project_dir = _pollen_project_dir(pid)
    (project_dir / "data").mkdir(parents=True, exist_ok=True)
    projects = _pollen_load_projects()
    entry = {"id": pid, "name": name, "created_at": _dt.datetime.now().isoformat()}
    projects.append(entry)
    _pollen_save_projects(projects)
    return {**entry, "configured": False}


@app.patch("/pollen/projects/{pid}")
def pollen_rename_project(pid: str, data: dict):
    """Rename a project."""
    _pollen_get_project(pid)
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Project name is required")
    projects = _pollen_load_projects()
    for p in projects:
        if p["id"] == pid:
            p["name"] = name
            break
    _pollen_save_projects(projects)
    cfg_path, _, _ = _pollen_project_paths(pid)
    updated = next(p for p in projects if p["id"] == pid)
    return {**updated, "configured": cfg_path.exists()}


@app.delete("/pollen/projects/{pid}", status_code=204)
def pollen_delete_project(pid: str):
    """Delete a project and all its data."""
    import shutil
    _pollen_get_project(pid)
    project_dir = _pollen_project_dir(pid)
    if project_dir.exists():
        shutil.rmtree(project_dir)
    projects = _pollen_load_projects()
    projects = [p for p in projects if p["id"] != pid]
    _pollen_save_projects(projects)


# ── Project-scoped endpoints ──────────────────────────────────────────────────

@app.get("/pollen/{pid}/leads")
def pollen_leads(pid: str, status: str = "", priority: str = ""):
    _pollen_get_project(pid)
    _, data_path, _ = _pollen_project_paths(pid)
    leads = _pollen_load_leads(data_path)
    items = list(leads.values())
    if status:
        items = [l for l in items if l.get("status") == status]
    if priority:
        items = [l for l in items if l.get("priority") == priority]
    priority_order = {"hot": 0, "warm": 1, "cold": 2}
    items.sort(key=lambda x: priority_order.get(x.get("priority", "cold"), 2))
    return items


@app.get("/pollen/{pid}/leads/starred")
def pollen_starred_leads(pid: str):
    _pollen_get_project(pid)
    _, data_path, _ = _pollen_project_paths(pid)
    leads = _pollen_load_leads(data_path)
    return [l for l in leads.values() if l.get("starred")]


@app.patch("/pollen/{pid}/leads/{lid}")
def pollen_update_lead(pid: str, lid: str, data: dict):
    _pollen_get_project(pid)
    _, data_path, _ = _pollen_project_paths(pid)
    leads = _pollen_load_leads(data_path)
    if lid not in leads:
        raise HTTPException(404, "Lead not found")
    for field in ("status", "notes", "starred"):
        if field in data:
            leads[lid][field] = data[field]
    _pollen_save_leads(data_path, leads)
    return leads[lid]


@app.delete("/pollen/{pid}/leads/{lid}", status_code=204)
def pollen_delete_lead(pid: str, lid: str):
    _pollen_get_project(pid)
    _, data_path, _ = _pollen_project_paths(pid)
    leads = _pollen_load_leads(data_path)
    if lid not in leads:
        raise HTTPException(404, "Lead not found")
    del leads[lid]
    _pollen_save_leads(data_path, leads)


@app.get("/pollen/{pid}/stats")
def pollen_stats(pid: str):
    _pollen_get_project(pid)
    _, data_path, _ = _pollen_project_paths(pid)
    leads = _pollen_load_leads(data_path)
    items = list(leads.values())
    return {
        "total":     len(items),
        "new":       sum(1 for l in items if l.get("status") == "new"),
        "hot":       sum(1 for l in items if l.get("priority") == "hot"),
        "contacted": sum(1 for l in items if l.get("status") == "contacted"),
        "reviewed":  sum(1 for l in items if l.get("status") == "reviewed"),
        "starred":   sum(1 for l in items if l.get("starred")),
    }


@app.get("/pollen/{pid}/context")
def pollen_agent_context(pid: str):
    """Return the full context the AI agent uses when qualifying leads."""
    _pollen_get_project(pid)
    cfg_path, data_path, _ = _pollen_project_paths(pid)
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

    qualifier_prompt = f"""{cfg.get('qualifier_context', '')}

Your job: evaluate a raw search result and decide if it is a good prospective lead.

Strong signals:
{strong}

Weak or irrelevant signals:
{weak}

Return ONLY valid JSON (no markdown, no explanation):
{{
  "{lead_field}": "...",
  "category": "{categories}",
  "country": "{geographies}",
  "fit_score": 1-10,
  "fit_reason": "1-2 sentence reason for the score",
  "priority": "hot|warm|cold",
  "outreach_email": {{
    "subject": "...",
    "body": "..."
  }},
  "source_url": "...",
  "signal_type": "{signal_types}",
  "raw_snippet": "..."
}}

fit_score guide: {hot_min}-10 = hot (clear signal), {warm_min}-{hot_min - 1} = warm (indirect signal), 1-{warm_min - 1} = cold (weak fit).
priority mirrors score: {hot_min}-10=hot, {warm_min}-{hot_min - 1}=warm, 1-{warm_min - 1}=cold.

The outreach email should:
- Be from {sender} at {company} ({company_desc})
- Reference the specific signal you found (be specific, not generic)
- Be concise: 4-6 sentences max
- Subject line: compelling, not salesy
- Do NOT invent facts. Only reference what's in the snippet.""".strip()

    starred_leads = []
    if data_path.exists():
        try:
            with open(data_path) as f:
                all_leads = json.load(f)
            starred_leads = [
                {
                    "company_name": l.get("company_name", l.get("brand_name", "?")),
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
            f"The user has flagged these as GREAT leads (starred). "
            f"Use them to calibrate your scoring — companies with similar profiles, signals, or language should score higher:\n{lines}"
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


@app.get("/pollen/{pid}/log")
def pollen_log(pid: str):
    _pollen_get_project(pid)
    _, _, log_path = _pollen_project_paths(pid)
    if log_path.exists():
        lines = log_path.read_text().splitlines()[-50:]
        return {"log": "\n".join(lines)}
    return {"log": "No log yet."}


@app.get("/pollen/{pid}/status")
def pollen_status(pid: str):
    """Returns current job status for this project."""
    _pollen_get_project(pid)
    status = _pollen_read_status(pid)
    # If the job is "running" but the PID-tracked process is gone, auto-clear it.
    # We use the status file's own timestamp — if it's been running for >30 min, mark stale.
    if status.get("state") == "running" and status.get("ts"):
        import datetime as _dt
        try:
            started = _dt.datetime.fromisoformat(status["ts"])
            age = (_dt.datetime.now() - started).total_seconds()
            if age > 1800:  # 30 minutes max
                _pollen_write_status(pid, status.get("job", "run"), "done", "timed out")
                status = _pollen_read_status(pid)
        except Exception:
            pass
    return status


@app.post("/pollen/{pid}/run")
def pollen_run(pid: str):
    """Trigger a manual agent run in the background."""
    _pollen_get_project(pid)
    # Reject if a job is already running
    current = _pollen_read_status(pid)
    if current.get("state") == "running":
        raise HTTPException(409, f"A {current.get('job', 'job')} is already running")
    project_dir = str(_pollen_project_dir(pid))
    agent_script = str(POLLEN_DIR / "agent.py")
    venv_python = str(Path(__file__).parent.parent / "venv" / "bin" / "python3")
    env = os.environ.copy()
    pollen_env = POLLEN_DIR / ".env"
    if pollen_env.exists():
        for line in pollen_env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    try:
        _pollen_write_status(pid, "run", "running", "Agent searching for leads…")
        proc = subprocess.Popen(
            [venv_python, agent_script, "--project-dir", project_dir],
            cwd=str(POLLEN_DIR),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _pollen_procs[pid] = proc
        # Background thread to mark done when process exits
        import threading
        def _watch(p, _pid):
            p.wait()
            _pollen_procs.pop(_pid, None)
            # Only update status if it wasn't already set to stopped/error
            current = _pollen_read_status(_pid)
            if current.get("state") == "running":
                _pollen_write_status(_pid, "run", "done", "Run complete")
        threading.Thread(target=_watch, args=(proc, pid), daemon=True).start()
        return {"status": "started"}
    except Exception as e:
        _pollen_write_status(pid, "run", "error", str(e))
        raise HTTPException(500, f"Failed to start agent: {e}")


@app.post("/pollen/{pid}/stop")
def pollen_stop(pid: str):
    """Stop a running agent for this project."""
    _pollen_get_project(pid)
    proc = _pollen_procs.pop(pid, None)
    if proc is not None:
        try:
            proc.terminate()
        except Exception:
            pass
    _pollen_write_status(pid, "run", "done", "Stopped by user")
    return {"status": "stopped"}


@app.post("/pollen/{pid}/cleanup")
def pollen_cleanup(pid: str):
    """Run the AI cleanup agent (dedup + archive removal) in the foreground and return a summary."""
    _pollen_get_project(pid)
    current = _pollen_read_status(pid)
    if current.get("state") == "running":
        raise HTTPException(409, f"A {current.get('job', 'job')} is already running")
    project_dir   = str(_pollen_project_dir(pid))
    cleanup_script = str(POLLEN_DIR / "cleanup.py")
    venv_python   = str(Path(__file__).parent.parent / "venv" / "bin" / "python3")
    env = os.environ.copy()
    pollen_env = POLLEN_DIR / ".env"
    if pollen_env.exists():
        for line in pollen_env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    _pollen_write_status(pid, "cleanup", "running", "Scanning for duplicates…")
    try:
        result = subprocess.run(
            [venv_python, cleanup_script, "--project-dir", project_dir],
            cwd=str(POLLEN_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            _pollen_write_status(pid, "cleanup", "error", result.stderr[:200])
            raise HTTPException(500, f"Cleanup failed: {result.stderr[:500]}")
        summary_path = Path(project_dir) / "data" / "cleanup_summary.json"
        if summary_path.exists():
            with open(summary_path) as f:
                summary = json.load(f)
        else:
            summary = {"total_removed": 0, "remaining": 0}
        detail = f"Removed {summary.get('total_removed', 0)} duplicates, {summary.get('remaining', 0)} leads remain"
        _pollen_write_status(pid, "cleanup", "done", detail)
        return summary
    except subprocess.TimeoutExpired:
        _pollen_write_status(pid, "cleanup", "error", "Timed out")
        raise HTTPException(504, "Cleanup timed out")
    except HTTPException:
        raise
    except Exception as e:
        _pollen_write_status(pid, "cleanup", "error", str(e))
        raise HTTPException(500, f"Failed to run cleanup: {e}")


@app.patch("/pollen/{pid}/config")
def pollen_patch_config(pid: str, payload: dict):
    """Patch specific fields in a project's config.json."""
    _pollen_get_project(pid)
    cfg_path, _, _ = _pollen_project_paths(pid)
    if not cfg_path.exists():
        raise HTTPException(404, "Config not found. Complete onboarding first.")
    with open(cfg_path) as f:
        cfg = json.load(f)
    cfg.update(payload)
    with open(cfg_path, "w") as f:
        json.dump(cfg, f, indent=2)
    return {"ok": True}


@app.get("/pollen/{pid}/config/status")
def pollen_config_status(pid: str):
    """Returns whether a config exists for this project."""
    _pollen_get_project(pid)
    cfg_path, _, _ = _pollen_project_paths(pid)
    return {"configured": cfg_path.exists()}


@app.get("/pollen/{pid}/config")
def pollen_config_get(pid: str):
    _pollen_get_project(pid)
    cfg_path, _, _ = _pollen_project_paths(pid)
    if not cfg_path.exists():
        raise HTTPException(404, "Not configured yet")
    with open(cfg_path) as f:
        return json.load(f)


@app.post("/pollen/{pid}/config")
def pollen_config_save(pid: str, data: dict):
    _pollen_get_project(pid)
    cfg_path, _, _ = _pollen_project_paths(pid)
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cfg_path, "w") as f:
        json.dump(data, f, indent=2)
    return {"ok": True}


@app.websocket("/pollen/ws/onboard")
async def pollen_onboard(ws: WebSocket, project_id: str = ""):
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
        _pollen_get_project(project_id)
    except HTTPException:
        await ws.send_text(json.dumps({"type": "error", "content": f"Project not found: {project_id}"}))
        await ws.close()
        return

    cfg_path, _, _ = _pollen_project_paths(project_id)

    OLLAMA_URL = "http://localhost:11434/api/chat"
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

    SYSTEM = """You are a setup assistant for a BD (business development) automation agent.
Your job is to gather enough information to configure the agent for this user's specific business.

Ask questions ONE AT A TIME in a natural conversation. Cover these areas:
1. What does their company do and what's their core value proposition?
2. What do they offer to leads — why would a lead care?
3. Who exactly are they trying to reach? (company type, role, industry, geography)
4. What specific situations or events signal a good lead? (e.g. excess stock, restructuring, market exit, new funding)
5. What should be ignored — what looks relevant but isn't?
6. Who is sending the outreach — name, title, company?

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
  "qualifier_context": "2-3 sentence paragraph: who you are, what a good lead looks like, and what you offer them. Written for an AI evaluating search results.",
  "ideal_customer_profile": "Specific description of the ideal target company: type, size, situation, geography, and what makes them a perfect fit.",
  "what_we_offer": "One paragraph: what your company offers leads and why they should respond.",
  "strong_signals": [
    "Specific observable signal that indicates a great lead — be concrete, not generic",
    "..."
  ],
  "weak_signals": [
    "What looks relevant but should score low or be ignored",
    "..."
  ],
  "result_schema": {
    "lead_name_field": "company_name",
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
- Queries run verbatim on the selected channels. Make them specific — include industry terms, geography, company types, trigger events.
- Bad: "FMCG expansion MY". Good: "FMCG distributor warehouse clearance Malaysia 2024".
- Generate 3-5 signal groups, each with 4-6 queries.
- Cover different angles: seller signals, buyer signals, event triggers, geography variations.

For search_channels — choose an ordered priority list from:
  "linkedin"   → LinkedIn company pages (great for B2B, headcount signals, job posts)
  "reddit"     → Reddit communities (great for consumer brands, community buzz, complaints)
  "instagram"  → Instagram brand pages (great for DTC, fashion, food & bev)
  "facebook"   → Facebook pages (great for local businesses, retail, classifieds)
  "news"       → Google News (great for press releases, funding, restructuring signals)
  "google"     → Plain Google search (broad fallback, always useful)

Pick 2-4 channels most relevant to the target market. Order by most-likely-to-yield signal.
Example for B2B supply chain: ["linkedin", "news", "google"]
Example for DTC/consumer brands: ["instagram", "facebook", "reddit", "google"]
"""

    history: list[dict] = []

    # Kick off the conversation
    init_msg = "Hello, I'd like to set up the BD agent for my business."
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


@app.websocket("/pollen/ws/correct")
async def pollen_correct(ws: WebSocket, project_id: str = ""):
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
        _pollen_get_project(project_id)
    except HTTPException:
        await ws.send_text(json.dumps({"type": "error", "content": f"Project not found: {project_id}"}))
        await ws.close()
        return

    cfg_path, data_path, _ = _pollen_project_paths(project_id)

    OLLAMA_URL = "http://localhost:11434/api/chat"
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

    leads_summary = "\n".join([
        f"- {l.get('company_name','?')} | score={l.get('fit_score','?')} | signal={l.get('signal_type','?')} | country={l.get('country','?')} | reason={l.get('fit_reason','?')[:80]}"
        for l in leads_sample
    ]) or "No leads generated yet."

    starred_summary = "\n".join([
        f"- {l.get('company_name','?')} | signal={l.get('signal_type','?')} | country={l.get('country','?')} | snippet={l.get('raw_snippet','')[:120]} | reason={l.get('fit_reason','?')[:100]}"
        for l in starred_leads
    ]) if starred_leads else ""

    current_queries = "\n".join([
        f"  [{g['signal']}]: " + " / ".join(g['queries'])
        for g in current_cfg.get("search_queries", [])
    ])

    starred_section = f"""
The user has marked the following leads as GREAT examples (starred ⭐). These are the kind of companies to find MORE of:
{starred_summary}

Use these examples to understand what specific company types, signals, and language patterns work well. Craft new search queries that would surface more companies like these.
""" if starred_summary else ""

    icp = current_cfg.get("ideal_customer_profile", "")
    what_we_offer = current_cfg.get("what_we_offer", "")

    # Pre-escape for safe embedding in the f-string CONFIG template
    qualifier_context_esc = current_cfg.get("qualifier_context", "").replace('"', '\\"')
    icp_esc = icp.replace('"', '\\"')
    what_we_offer_esc = what_we_offer.replace('"', '\\"')

    # Serialise current values so the LLM can carry them forward verbatim
    current_strong  = json.dumps(current_cfg.get("strong_signals", []), ensure_ascii=False)
    current_weak    = json.dumps(current_cfg.get("weak_signals", []), ensure_ascii=False)
    current_cats    = json.dumps(current_cfg.get("result_schema", {}).get("categories", []), ensure_ascii=False)
    current_geos    = json.dumps(current_cfg.get("result_schema", {}).get("geographies", []), ensure_ascii=False)
    current_sigs    = json.dumps(current_cfg.get("result_schema", {}).get("signal_types", []), ensure_ascii=False)
    current_queries_json  = json.dumps(current_cfg.get("search_queries", []), indent=4, ensure_ascii=False)
    current_thresholds    = json.dumps(current_cfg.get("score_thresholds", {"hot_min": 8, "warm_min": 5, "save_min": 4}), ensure_ascii=False)
    current_channels      = json.dumps(current_cfg.get("search_channels", ["linkedin", "google", "news"]), ensure_ascii=False)

    SYSTEM = f"""You are a lead generation strategist making targeted corrections to a BD agent's config.

CURRENT CONFIG (your baseline — preserve everything the user has NOT complained about):
- Qualifier context: {current_cfg.get('qualifier_context', '')}
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

Sample of leads generated so far:
{leads_summary}
{starred_section}

INSTRUCTIONS:
- The user is describing a SPECIFIC problem with the current leads — do NOT rewrite everything.
- Only change the fields that are directly relevant to the user's feedback. Carry forward all other values exactly as they are above.
- If the user says queries are too generic → update search_queries only.
- If the user says wrong geography → update geographies and search_queries only.
- If the user says wrong type of companies → update strong_signals, weak_signals, and search_queries.
- If the user says context is wrong → update qualifier_context and/or ideal_customer_profile.
- If the user says wrong channels or wants to add/change channels → update search_channels only.
- You may ask AT MOST ONE short clarifying question — only if genuinely needed. Then output the config.
- Make search queries SPECIFIC — include geography, industry terms, company types, trigger events. Bad: "FMCG expansion MY". Good: "FMCG distributor warehouse clearance Malaysia 2024".
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
  "strong_signals": {current_strong},
  "weak_signals": {current_weak},
  "result_schema": {{
    "lead_name_field": "company_name",
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
        "content": "Got it — what's wrong with the current leads? I'll make targeted corrections while keeping everything that's working.",
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


# ─── WebSocket Chat ─────────────────────────────────────────────────────────────

# Column order for the output CSV (matches the user's Excel template)
OUTPUT_COLUMN_ORDER = [
    "sku", "product_name", "quantity_in_units", "barcode", "barcode_key",
    "batch_code", "units_per_carton", "total_carton", "unit_size", "color",
    "gender", "brand", "category", "sub_category", "local_currency",
    "retail_price_local", "asking_price_local", "discount",
    "warehouse_location", "image_url", "expiry_date", "manufacturing_date",
    "remarks", "weight_per_unit", "net_weight_of_carton", "cbm_per_carton",
    "amazon_links", "other_notes",
]

NICE_COLUMN_NAMES = {
    "sku": "SKU",
    "product_name": "Product Name",
    "quantity_in_units": "Quantity in units",
    "barcode": "Barcode",
    "barcode_key": "Barcode Key",
    "batch_code": "Batch Code",
    "units_per_carton": "Units Per Carton",
    "total_carton": "Total Carton",
    "unit_size": "Unit Size",
    "color": "Color",
    "gender": "Gender",
    "brand": "Brand",
    "category": "Category",
    "sub_category": "Sub Category",
    "local_currency": "Local Currency",
    "retail_price_local": "Retail Price (Local)",
    "asking_price_local": "Asking Price (Local)",
    "discount": "Discount",
    "warehouse_location": "Warehouse Location",
    "image_url": "Image URL",
    "expiry_date": "Expiry Date (YYYY-MM-DD)",
    "manufacturing_date": "Manufacturing Date",
    "remarks": "Remarks",
    "weight_per_unit": "Weight per unit",
    "net_weight_of_carton": "Net weight of carton",
    "cbm_per_carton": "CBM per carton",
    "amazon_links": "Amazon Links",
    "other_notes": "Other Notes",
}

# A fixed "cleaned template" export that always includes every required header
# in the expected order from the business template.
CLEAN_TEMPLATE_COLUMN_ORDER = [
    "sku", "product_name", "quantity_in_units", "barcode", "barcode_key",
    "batch_code", "units_per_carton", "total_carton", "unit_size", "color",
    "brand", "category", "sub_category", "local_currency",
    "retail_price_local", "asking_price_local", "discount",
    "warehouse_location", "image_url", "expiry_date", "manufacturing_date",
    "remarks", "weight_per_unit", "net_weight_of_carton", "cbm_per_carton",
    "amazon_links", "other_notes",
]

CLEAN_TEMPLATE_NICE_COLUMN_NAMES = {
    "sku": "SKU",
    "product_name": "Product Name",
    "quantity_in_units": "Quantity in units",
    "barcode": "Barcode",
    "barcode_key": "Barcode Key (EAN/UPC)",
    "batch_code": "Batch Code",
    "units_per_carton": "Units Per Carton",
    "total_carton": "Total Carton",
    "unit_size": "Unit Size",
    "color": "Color",
    "brand": "Brand",
    "category": "Category",
    "sub_category": "Sub Category",
    "local_currency": "Local Currency",
    "retail_price_local": "Retail Price (Local)",
    "asking_price_local": "Asking Price (Local)",
    "discount": "Discount",
    "warehouse_location": "Warehouse Location",
    "image_url": "Image URL",
    "expiry_date": "Expiry Date (YYYY-MM-DD)",
    "manufacturing_date": "Manufacturing Date",
    "remarks": "Remarks",
    "weight_per_unit": "Weight per unit",
    "net_weight_of_carton": "Net weight of carton",
    "cbm_per_carton": "CBM per carton",
    "amazon_links": "Amazon Links",
    "other_notes": "Other Notes",
}


class ChatSession:
    def __init__(self):
        self.file_id: Optional[str] = None
        self.sheet_name: Optional[str] = None
        self.mapping: Optional[Dict[str, str]] = None
        self.parsed: Optional[Dict] = None
        self.original_filename: Optional[str] = None
        self.file_type: Optional[str] = None
        self.unpivoted_df: Optional[pd.DataFrame] = None
        self.was_unpivoted: bool = False
        self.mapping_confidence: Dict[str, float] = {}
        self.low_confidence_fields: List[str] = []
        self.normalized_df: Optional[pd.DataFrame] = None
        self.enrichment_context_rows: List[Dict[str, str]] = []
        self.enrichment_cursor: int = 0
        self.enrichment_batch_size: int = 100
        self.enrichment_profile: Dict[str, str] = {}
        self.awaiting_enrichment_context: bool = False
        self.enrichment_needed: bool = False
        self.pending_inferred_context: Dict[str, str] = {}
        self.supplementary_data: Optional[Dict] = None
        self.supplementary_summary: Dict = {}


async def ws_send(ws: WebSocket, msg_type: str, content):
    await ws.send_text(json.dumps({"type": msg_type, "content": content}))


async def ws_progress(
    ws: WebSocket,
    label: str,
    current: Optional[int] = None,
    total: Optional[int] = None,
    active: bool = True,
):
    percent = None
    if current is not None and total:
        percent = int((current / total) * 100)
    await ws_send(ws, "progress", {
        "active": active,
        "label": label,
        "current": current,
        "total": total,
        "percent": percent,
    })


@app.websocket("/ws/chat")
async def chat_endpoint(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()
    session = ChatSession()

    await ws_send(websocket, "agent", (
        "Hello! I'm your Inventory Parser assistant. "
        "Upload an Excel or CSV file and I'll map it to the standard output template."
    ))

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type", "user")
            content = msg.get("content", {})

            # ── File uploaded ──────────────────────────────────────────────────
            if msg_type == "file_uploaded":
                session.file_id = content["file_id"]
                session.original_filename = content["original_filename"]
                session.file_type = content["file_type"]
                session.sheet_name = content.get("selected_sheet") or content["sheet_names"][0]

                ext = Path(session.original_filename).suffix.lower()
                filepath = str(UPLOAD_DIR / f"{session.file_id}{ext}")
                session.parsed = inv_parser.detect_and_parse(filepath)
                meta = session.parsed.get("_meta", {})
                sheet_info = session.parsed[session.sheet_name]

                try:
                    session.supplementary_data = inv_parser.extract_sheet_supplementary(
                        filepath, session.sheet_name
                    )
                    session.supplementary_summary = agent.summarize_supplementary_context(
                        session.supplementary_data
                    )
                except Exception:
                    session.supplementary_data = None
                    session.supplementary_summary = {}

                await ws_send(websocket, "agent", (
                    f"Received **{session.original_filename}**. Analysing..."
                ))
                await ws_progress(websocket, "Analyzing file structure...")

                # Thinking: show reasoning about file structure
                headers = sheet_info["headers"]
                row_count = sheet_info["row_count"]
                thinking_lines = [
                    f"File has {len(headers)} columns and {row_count} rows.",
                    f"Columns detected: {', '.join(headers[:12])}{'...' if len(headers) > 12 else ''}.",
                    f"Checking if this is a product inventory with identifiable fields (SKU, name, price, qty, barcode).",
                ]
                await ws_send(websocket, "thinking", "\n".join(thinking_lines))

                # Step 1: file analysis
                analysis = await agent.analyze_file(sheet_info, meta, session.sheet_name)
                await ws_send(websocket, "agent", analysis)
                await ws_progress(websocket, "Analysis complete", active=False)

                # Step 1.1: report supplementary data if found
                supp = session.supplementary_summary
                if supp and any([
                    supp.get("seller_name"),
                    supp.get("reference_rates"),
                    supp.get("pricing_notes"),
                ]):
                    supp_parts = []
                    if supp.get("seller_name"):
                        supp_parts.append(
                            f"**Seller/Company**: {supp['seller_name']}"
                        )
                    if supp.get("data_sources"):
                        supp_parts.append(
                            f"**Data Sources**: {supp['data_sources']}"
                        )
                    if supp.get("reference_rates"):
                        supp_parts.append(
                            f"**Market Reference Rates**: "
                            f"{len(supp['reference_rates'])} product benchmark(s) detected"
                        )
                    if supp.get("pricing_notes"):
                        notes_preview = "; ".join(supp["pricing_notes"][:3])
                        if len(notes_preview) > 200:
                            notes_preview = notes_preview[:200] + "..."
                        supp_parts.append(
                            f"**Pricing Notes**: {notes_preview}"
                        )
                    await ws_send(
                        websocket,
                        "agent",
                        "I also detected supplementary information in this sheet:\n"
                        + "\n".join(f"- {p}" for p in supp_parts),
                    )

                # Step 1.2: inventory feasibility gate
                await ws_send(websocket, "thinking",
                    "Assessing whether this sheet is a valid inventory file. "
                    "Looking for product-like columns (SKU, name, quantity, price, barcode) "
                    "and checking data patterns against known inventory formats."
                )
                is_inventory, reason, feasibility_conf = await agent.assess_inventory_feasibility(sheet_info)
                if not is_inventory:
                    await ws_send(
                        websocket,
                        "agent",
                        (
                            "This file does not look like a usable inventory sheet for normalization. "
                            f"Reason: **{reason}** (confidence: {feasibility_conf:.2f}).\n\n"
                            "Please recheck the file/sheet and upload a proper inventory list "
                            "(with product-like columns such as SKU, name, qty, price, barcode, etc.)."
                        ),
                    )
                    await ws_progress(websocket, "File rejected: not an inventory sheet", active=False)
                    session.mapping = None
                    continue

                # Step 1.5: detect wide format (sizes as columns)
                wide_info = await agent.detect_wide_format_llm(sheet_info)
                if wide_info and wide_info.get("is_wide"):
                    size_cols = wide_info["size_columns"]
                    await ws_send(websocket, "agent", (
                        f"Detected **wide format** - sizes spread as columns: "
                        f"**{', '.join(size_cols[:8])}**"
                        f"{' ...' if len(size_cols) > 8 else ''}. "
                        f"Unpivoting {len(size_cols)} size columns into rows "
                        f"(each size becomes its own row with a quantity)."
                    ))
                    await ws_progress(websocket, "Unpivoting wide-format size columns...")

                    ext = Path(session.original_filename).suffix.lower()
                    filepath = str(UPLOAD_DIR / f"{session.file_id}{ext}")
                    unpivoted_df = inv_parser.unpivot_wide_format(
                        filepath, session.sheet_name, size_cols
                    )
                    session.unpivoted_df = unpivoted_df
                    session.was_unpivoted = True

                    new_sheet_info = inv_parser.get_unpivoted_sheet_info(unpivoted_df)
                    session.parsed[session.sheet_name] = new_sheet_info
                    sheet_info = new_sheet_info

                    await ws_send(websocket, "agent", (
                        f"Unpivoted successfully: **{len(unpivoted_df)}** rows "
                        f"(was {wide_info.get('original_rows', '?')} rows x {len(size_cols)} sizes). "
                        f"New columns include **_size** and **_qty**."
                    ))
                    await ws_progress(websocket, "Unpivot complete", active=False)

                # Step 2: column mapping (primary + secondary)
                await ws_send(websocket, "thinking",
                    "Starting column mapping. Will first identify primary fields "
                    "(product description, unit size, price, barcode, origin) then secondary fields "
                    "(shipping weight, dimensions, dates, warehouse). "
                    f"Analyzing {len(sheet_info['headers'])} columns against known field patterns "
                    "and sample data values."
                )
                await ws_send(websocket, "agent",
                    "Mapping primary fields (product identity, pricing) and secondary fields (shipping, dates)...")
                await ws_progress(websocket, "Running AI field mapping...")
                session.mapping, session.mapping_confidence, session.low_confidence_fields = (
                    await agent.map_columns_with_confidence(sheet_info)
                )
                await ws_progress(websocket, "Field mapping complete", active=False)

                primary_count = sum(1 for f in agent.PRIMARY_FIELDS if f in session.mapping)
                secondary_count = sum(1 for f in agent.SECONDARY_FIELDS if f in session.mapping)
                total = primary_count + secondary_count

                summary = (
                    f"Matched **{primary_count}** primary and **{secondary_count}** secondary fields "
                    f"({total} total). "
                    "Category/sub-category will be assigned per product row."
                )
                if session.low_confidence_fields:
                    summary += (
                        f" Low-confidence mappings: **{', '.join(session.low_confidence_fields)}**. "
                        "Please review these before confirming."
                    )
                await ws_send(websocket, "agent", summary)

                await ws_send(websocket, "mapping", {
                    "mapping": session.mapping,
                    "mapping_confidence": session.mapping_confidence,
                    "low_confidence_fields": session.low_confidence_fields,
                    "available_columns": sheet_info["headers"],
                    "sample_rows": sheet_info.get("sample_rows", []),
                    "sheet_name": session.sheet_name,
                })

            # ── User chat message ──────────────────────────────────────────────
            elif msg_type == "user":
                text: str = content.get("text", "").strip()
                if not text:
                    continue

                if session.mapping is None:
                    await ws_send(websocket, "agent",
                        "Please upload a file first.")
                    continue

                # If we're waiting for enrichment context, parse and continue enrichment.
                if session.awaiting_enrichment_context:
                    affirmatives = {"yes", "y", "confirm", "correct", "ok", "okay", "looks good", "proceed"}
                    if text.lower().strip() in affirmatives and session.pending_inferred_context:
                        session.enrichment_profile.update(session.pending_inferred_context)
                        _remember_context(session.enrichment_profile)
                        session.pending_inferred_context = {}
                        session.awaiting_enrichment_context = False
                        await ws_send(websocket, "agent", f"Context confirmed: `{json.dumps(session.enrichment_profile)}`")
                        await _run_enrichment_batch(websocket, session, first_batch=True)
                        continue

                    parsed_ctx = _parse_enrichment_context(text)
                    if not parsed_ctx:
                        await ws_send(
                            websocket,
                            "agent",
                            "Please provide enrichment context, e.g. "
                            "**seller=<seller>; brand=<brand>; domain=<domain>; market=<country>** "
                            "or reply **yes** to confirm inferred context.",
                        )
                        continue
                    session.enrichment_profile.update(parsed_ctx)
                    _remember_context(session.enrichment_profile)
                    session.pending_inferred_context = {}
                    session.awaiting_enrichment_context = False
                    await ws_send(websocket, "agent", f"Context saved: `{json.dumps(session.enrichment_profile)}`")
                    await _run_enrichment_batch(websocket, session, first_batch=True)
                    continue

                text_l = text.lower()
                if any(k in text_l for k in ["set enrichment context", "enrichment context", "seller=", "domain=", "brand="]):
                    parsed_ctx = _parse_enrichment_context(text)
                    if parsed_ctx:
                        session.enrichment_profile.update(parsed_ctx)
                        _remember_context(session.enrichment_profile)
                        await ws_send(websocket, "agent", f"Updated enrichment context: `{json.dumps(session.enrichment_profile)}`")
                    else:
                        await ws_send(
                            websocket,
                            "agent",
                            "Couldn't parse context. Example: "
                            "**set enrichment context seller=L'Oreal Thailand; brand=L'Oreal; domain=cosmetics; market=thailand**",
                        )
                    continue
                if any(k in text_l for k in ["start enrichment", "enrich start", "run enrichment"]):
                    if not session.enrichment_needed:
                        await ws_send(websocket, "agent", "Enrichment is not required for this file. Categories are already available.")
                        continue
                    await _run_enrichment_batch(websocket, session, first_batch=True)
                    continue
                if any(k in text_l for k in ["enrich next", "next enrichment", "continue enrichment"]):
                    if not session.enrichment_needed:
                        await ws_send(websocket, "agent", "Enrichment is not required for this file.")
                        continue
                    await _run_enrichment_batch(websocket, session, first_batch=False)
                    continue

                affirmatives = {"yes", "confirm", "ok", "looks good", "correct",
                                "confirmed", "proceed", "apply", "go ahead", "done",
                                "perfect", "great", "sure", "yep", "yeah"}
                if any(text.lower().startswith(w) for w in affirmatives) or \
                   text.lower() in affirmatives:
                    await ws_progress(websocket, "Applying mapping to all rows...")
                    await _apply_and_save(websocket, session, db)
                    await ws_progress(websocket, "Apply complete", active=False)
                else:
                    sheet_info = session.parsed[session.sheet_name]
                    await ws_send(websocket, "agent", "Updating the mapping...")
                    session.mapping = await agent.apply_correction(
                        session.mapping,
                        sheet_info["headers"],
                        text,
                    )
                    session.mapping_confidence, session.low_confidence_fields = (
                        agent.estimate_mapping_confidence(session.mapping, sheet_info)
                    )
                    await ws_send(websocket, "mapping", {
                        "mapping": session.mapping,
                        "mapping_confidence": session.mapping_confidence,
                        "low_confidence_fields": session.low_confidence_fields,
                        "available_columns": sheet_info["headers"],
                        "sample_rows": sheet_info.get("sample_rows", []),
                        "sheet_name": session.sheet_name,
                    })

            # ── Edit enriched cell ─────────────────────────────────────────────
            elif msg_type == "update_cell":
                row_idx = content.get("row_index")
                field = content.get("field")
                value = content.get("value", "")
                apply_all = content.get("apply_all", False)  # for units_per_carton bulk apply
                if (
                    session.normalized_df is not None
                    and isinstance(row_idx, int)
                    and field in ("category", "sub_category", "units_per_carton")
                    and 0 <= row_idx < len(session.normalized_df)
                ):
                    df = session.normalized_df
                    if field == "units_per_carton":
                        # Ensure column exists
                        if "units_per_carton" not in df.columns:
                            df["units_per_carton"] = ""
                        if "quantity_in_units" not in df.columns:
                            df["quantity_in_units"] = ""
                        rows_to_update = list(range(len(df))) if apply_all else [row_idx]
                        for idx in rows_to_update:
                            df.iat[idx, df.columns.get_loc("units_per_carton")] = value
                            # Recalculate quantity_in_units = total_carton * units_per_carton
                            try:
                                tc = float(str(df.iat[idx, df.columns.get_loc("total_carton")]).replace(",", "")) if "total_carton" in df.columns else 0
                                upc = float(str(value).replace(",", ""))
                                qty = tc * upc
                                df.iat[idx, df.columns.get_loc("quantity_in_units")] = str(int(qty) if qty == int(qty) else qty)
                            except (ValueError, TypeError):
                                pass
                    else:
                        col_loc = df.columns.get_loc(field)
                        df.iloc[row_idx, col_loc] = value
                    _save_output(session.file_id, session.normalized_df)
                    await _send_preview(websocket, session.file_id, session.normalized_df)
                continue

            # ── Delete row ─────────────────────────────────────────────────────
            elif msg_type == "delete_row":
                row_idx = content.get("row_index")
                if (
                    session.normalized_df is not None
                    and isinstance(row_idx, int)
                    and 0 <= row_idx < len(session.normalized_df)
                ):
                    session.normalized_df = session.normalized_df.drop(
                        index=session.normalized_df.index[row_idx]
                    ).reset_index(drop=True)
                    _save_output(session.file_id, session.normalized_df)
                    await _send_preview(websocket, session.file_id, session.normalized_df)
                continue

            # ── Confirm mapping ────────────────────────────────────────────────
            elif msg_type == "confirm_mapping":
                if session.parsed is None or session.sheet_name is None:
                    await ws_send(websocket, "error",
                        "Session state was lost (likely a reconnect). Please re-upload your file.")
                    continue
                if "mapping" in content:
                    session.mapping = content["mapping"]
                await _apply_and_save(websocket, session, db)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await ws_send(websocket, "error", str(e))


async def _apply_and_save(websocket: WebSocket, session: ChatSession, db: Session):
    if session.parsed is None or session.sheet_name is None:
        await ws_send(websocket, "error",
            "Session state was lost (likely a reconnect). Please re-upload your file.")
        return
    sheet_info = session.parsed[session.sheet_name]

    summary = agent.generate_mapping_summary(session.mapping, sheet_info["row_count"])
    await ws_send(websocket, "agent", summary)
    await ws_progress(websocket, "Building normalized dataset...")

    ext = Path(session.original_filename).suffix.lower()
    filepath = str(UPLOAD_DIR / f"{session.file_id}{ext}")

    pre_loaded = session.unpivoted_df if session.was_unpivoted else None
    df = inv_parser.apply_mapping(filepath, session.sheet_name, session.mapping,
                                   pre_loaded_df=pre_loaded)
    df = inv_parser.auto_calculate_discount(df)
    df = inv_parser.auto_calculate_cartons(df)
    df = df.reset_index(drop=True)
    # Do not auto-classify category during initial mapping.
    # If category/sub_category are unmapped, keep them blank and enrich later in batches.
    if "category" not in df.columns:
        df["category"] = ""
    if "sub_category" not in df.columns:
        df["sub_category"] = ""

    # Build enrichment context rows using mapped fields + source metadata fields
    source_df = pre_loaded.copy() if pre_loaded is not None else inv_parser.load_sheet_dataframe(filepath, session.sheet_name)
    session.enrichment_context_rows = _build_enrichment_context_rows(df, source_df)
    session.normalized_df = df.copy()
    session.enrichment_cursor = 0
    session.enrichment_profile = {}
    session.awaiting_enrichment_context = False
    session.enrichment_needed = _is_enrichment_needed(session.normalized_df)
    session.pending_inferred_context = {}

    supp = session.supplementary_summary or {}
    if supp:
        if supp.get("seller_name"):
            session.enrichment_profile["seller_name"] = supp["seller_name"]
        if supp.get("reference_rates"):
            ref_products = [
                r.get("Product", r.get("product", ""))
                for r in supp["reference_rates"]
                if isinstance(r, dict)
            ]
            ref_products = [p for p in ref_products if p]
            if ref_products:
                session.enrichment_profile["reference_products"] = ", ".join(
                    ref_products[:15]
                )

    output_path, ordered_cols = _save_output(session.file_id, session.normalized_df)
    await _send_preview(websocket, session.file_id, session.normalized_df)
    await ws_progress(websocket, "Normalized output ready", active=False)

    rows_for_db = session.normalized_df.fillna("").to_dict(orient="records")
    save_inventory(
        db=db,
        session_id=session.file_id,
        filename=session.original_filename,
        file_type=session.file_type,
        sheet_name=session.sheet_name,
        mapping=session.mapping,
        rows=rows_for_db,
        output_path=output_path,
    )

    mapped_count = len(session.mapping)
    if session.enrichment_needed:
        await ws_send(websocket, "agent", (
            f"Done! Processed **{len(session.normalized_df)} rows** with **{len(ordered_cols)} output fields**. "
            "Some Category/Sub Category values are missing. "
            "Type **start enrichment** to run product-level taxonomy enrichment in batches."
        ))
    else:
        await ws_send(websocket, "agent", (
            f"Done! Processed **{len(session.normalized_df)} rows** with **{len(ordered_cols)} output fields**. "
            "Category/Sub Category data is already available, so enrichment is not required."
        ))

    await ws_send(websocket, "done", {
        "file_id": session.file_id,
        "row_count": len(session.normalized_df),
        "mapped_fields": mapped_count,
        "enrichment_needed": session.enrichment_needed,
    })


def _save_output(file_id: str, df: pd.DataFrame) -> tuple[str, List[str]]:
    """Save normalized output CSV and return (path, ordered_cols)."""
    ordered_cols = [c for c in OUTPUT_COLUMN_ORDER if c in df.columns]
    df_out = df[ordered_cols]
    rename_map = {k: NICE_COLUMN_NAMES.get(k, k) for k in ordered_cols}
    df_output = df_out.rename(columns=rename_map)
    output_path = str(OUTPUT_DIR / f"{file_id}_normalized.csv")
    df_output.to_csv(output_path, index=False)

    # Also save a strict clean-template export with every expected header,
    # even when the original file did not map those fields.
    clean_df = df.copy()
    for col in CLEAN_TEMPLATE_COLUMN_ORDER:
        if col not in clean_df.columns:
            clean_df[col] = ""
    clean_df = clean_df[CLEAN_TEMPLATE_COLUMN_ORDER]
    clean_rename_map = {k: CLEAN_TEMPLATE_NICE_COLUMN_NAMES.get(k, k) for k in CLEAN_TEMPLATE_COLUMN_ORDER}
    clean_output = clean_df.rename(columns=clean_rename_map)
    clean_output_path = str(OUTPUT_DIR / f"{file_id}_clean_template.csv")
    clean_output.to_csv(clean_output_path, index=False)

    return output_path, ordered_cols


async def _send_preview(websocket: WebSocket, file_id: str, df: pd.DataFrame):
    # Determine whether units_per_carton has real data in the df
    upc_col = "units_per_carton"
    upc_mapped = (
        upc_col in df.columns
        and df[upc_col].replace("", pd.NA).dropna().shape[0] > 0
    )
    # total_carton present and has data → user may need to enter units_per_carton
    tc_col = "total_carton"
    total_carton_mapped = (
        tc_col in df.columns
        and df[tc_col].replace("", pd.NA).dropna().shape[0] > 0
    )

    # Ensure units_per_carton column exists so the editable input renders
    if total_carton_mapped and not upc_mapped and upc_col not in df.columns:
        df[upc_col] = ""

    ordered_cols = [c for c in OUTPUT_COLUMN_ORDER if c in df.columns]
    rename_map = {k: NICE_COLUMN_NAMES.get(k, k) for k in ordered_cols}
    df_output = df[ordered_cols].rename(columns=rename_map)
    preview_rows = df_output.head(20).fillna("").to_dict(orient="records")

    await ws_send(websocket, "preview", {
        "columns": list(df_output.columns),
        "rows": preview_rows,
        "total_rows": len(df),
        "file_id": file_id,
        "taxonomy": CATEGORY_TAXONOMY,
        "units_per_carton_mapped": upc_mapped,
        "total_carton_mapped": total_carton_mapped,
    })


def _build_enrichment_context_rows(df_mapped: pd.DataFrame, df_source: pd.DataFrame) -> List[Dict[str, str]]:
    """
    Build per-row enrichment context using mapped fields plus useful source columns.
    Keeps row order to allow batch updates by index.
    """
    ctx_rows: List[Dict[str, str]] = []
    src = df_source.fillna("").astype(str).reset_index(drop=True)
    mapped = df_mapped.fillna("").astype(str).reset_index(drop=True)
    n = min(len(mapped), len(src))

    seller_tokens = ["sqname", "seller", "vendor", "supplier", "merchant", "store"]
    useful_tokens = [
        "barcode", "ean", "upc", "gtin", "sku", "item", "product", "name", "title",
        "brand", "desc", "description", "remark", "note",
    ] + seller_tokens

    useful_source_cols = []
    for col in src.columns:
        ncol = str(col).lower()
        if any(t in ncol for t in useful_tokens):
            useful_source_cols.append(col)

    for i in range(n):
        row: Dict[str, str] = {}
        for key in ["product_name", "barcode", "barcode_key", "sku", "brand", "remarks", "other_notes"]:
            if key in mapped.columns:
                row[key] = str(mapped.at[i, key] or "")
        for col in useful_source_cols:
            row[str(col)] = str(src.at[i, col] or "")
        ctx_rows.append(row)
    return ctx_rows


async def _run_enrichment_batch(websocket: WebSocket, session: ChatSession, first_batch: bool):
    if session.normalized_df is None or len(session.normalized_df) == 0:
        await ws_send(websocket, "agent", "No mapped data found yet. Confirm mapping first, then run enrichment.")
        return

    df = session.normalized_df
    total = len(df)
    if first_batch:
        session.enrichment_cursor = 0
        # Pre-check context before first enrichment batch.
        if not _has_sufficient_enrichment_context(session.enrichment_profile):
            inferred = _infer_enrichment_context(session.enrichment_context_rows)
            memory_suggestion = _suggest_context_from_memory(inferred)
            if memory_suggestion:
                session.pending_inferred_context = memory_suggestion
                session.awaiting_enrichment_context = True
                await ws_send(
                    websocket,
                    "agent",
                    (
                        f"From previous conversations, I found a likely context: `{json.dumps(memory_suggestion)}`. "
                        "Reply **yes** to use it, or provide corrected context:\n"
                        "**seller=<seller>; brand=<brand>; domain=<domain>; market=<country>**"
                    ),
                )
                return
            if inferred:
                session.pending_inferred_context = inferred
                session.awaiting_enrichment_context = True
                await ws_send(
                    websocket,
                    "agent",
                    (
                        f"I inferred context: `{json.dumps(inferred)}`. "
                        "Please confirm by replying **yes**, or provide corrected context:\n"
                        "**seller=<seller>; brand=<brand>; domain=<domain>; market=<country>**"
                    ),
                )
                return
            session.awaiting_enrichment_context = True
            await ws_send(
                websocket,
                "agent",
                "Before enrichment, please provide context so classification is accurate. "
                "Example: **seller=<seller>; brand=<brand>; domain=<domain>; market=<country>**",
            )
            return

    start = session.enrichment_cursor
    if start >= total:
        await ws_send(websocket, "agent", "Enrichment already completed for all rows.")
        return

    end = min(total, start + session.enrichment_batch_size)
    batch_rows = session.enrichment_context_rows[start:end] if session.enrichment_context_rows else []
    if not batch_rows:
        await ws_send(websocket, "agent", "No enrichment context found for this batch.")
        return

    await ws_send(
        websocket,
        "agent",
        f"Running enrichment batch **{start + 1}-{end}** of **{total}** using context: `{json.dumps(session.enrichment_profile)}`...",
    )
    await ws_progress(websocket, "Running enrichment batch...", current=start, total=total)
    enriched = await agent.classify_rows_enriched(batch_rows, context=session.enrichment_profile)

    cats: List[str] = []
    subs: List[str] = []
    confs: List[float] = []
    for cat, sub, conf in enriched:
        cats.append(cat)
        subs.append(sub)
        confs.append(conf)

    # Only fill rows where category/sub_category are blank.
    slice_idx = range(start, end)
    cat_col_idx = df.columns.get_loc("category")
    sub_col_idx = df.columns.get_loc("sub_category")
    for j, idx in enumerate(slice_idx):
        # Use positional indexing to avoid KeyError when DataFrame index labels are non-consecutive.
        if str(df.iloc[idx, cat_col_idx]).strip() == "":
            df.iloc[idx, cat_col_idx] = cats[j]
        if str(df.iloc[idx, sub_col_idx]).strip() == "":
            df.iloc[idx, sub_col_idx] = subs[j]

    session.normalized_df = df
    session.enrichment_cursor = end

    output_path, ordered_cols = _save_output(session.file_id, session.normalized_df)
    await _send_preview(websocket, session.file_id, session.normalized_df)
    await ws_progress(websocket, "Enrichment progress", current=session.enrichment_cursor, total=total)

    avg_conf = round(sum(confs) / len(confs), 2) if confs else 0.0
    if session.enrichment_cursor < total:
        await ws_send(websocket, "agent", (
            f"Batch complete (**{start + 1}-{end}**). Avg enrichment confidence: **{avg_conf}**. "
            f"Progress: **{session.enrichment_cursor}/{total}**. Type **enrich next batch** to continue."
        ))
        await ws_progress(
            websocket,
            "Batch complete. Waiting for next batch command",
            current=session.enrichment_cursor,
            total=total,
            active=False,
        )
    else:
        await ws_send(websocket, "agent", (
            f"Enrichment completed for all **{total}** rows. "
            f"Avg final batch confidence: **{avg_conf}**. Output CSV updated."
        ))
        await ws_progress(websocket, "Enrichment completed", current=total, total=total, active=False)


def _parse_enrichment_context(text: str) -> Dict[str, str]:
    """
    Parse user-provided context in forms like:
    seller=...; brand=...; domain=...; market=...
    """
    ctx: Dict[str, str] = {}
    key_map = {
        "seller": "seller_name",
        "seller_name": "seller_name",
        "sqname": "seller_name",
        "brand": "brand_hint",
        "domain": "domain_hint",
        "market": "market_hint",
        "country": "market_hint",
        "notes": "notes",
        "context": "notes",
    }
    for raw_k, norm_k in key_map.items():
        m = re.search(rf"{raw_k}\s*[:=]\s*([^;,\n]+)", text, re.IGNORECASE)
        if m:
            ctx[norm_k] = m.group(1).strip()
    return ctx


def _infer_enrichment_context(rows: List[Dict[str, str]]) -> Dict[str, str]:
    """Infer seller/brand hints from source-like fields in enrichment rows."""
    if not rows:
        return {}
    seller_counts: Dict[str, int] = {}
    brand_counts: Dict[str, int] = {}
    for row in rows[:500]:
        for k, v in row.items():
            if not v:
                continue
            nk = str(k).lower()
            val = str(v).strip()
            if len(val) < 2:
                continue
            if any(t in nk for t in ["sqname", "seller", "vendor", "supplier", "merchant", "store"]):
                seller_counts[val] = seller_counts.get(val, 0) + 1
            if "brand" in nk or nk == "brand":
                brand_counts[val] = brand_counts.get(val, 0) + 1
    ctx: Dict[str, str] = {}
    if seller_counts:
        seller = max(seller_counts.items(), key=lambda x: x[1])[0]
        ctx["seller_name"] = seller
    if brand_counts:
        brand = max(brand_counts.items(), key=lambda x: x[1])[0]
        ctx["brand_hint"] = brand
    return ctx


def _has_sufficient_enrichment_context(ctx: Dict[str, str]) -> bool:
    return bool((ctx.get("seller_name") or "").strip() or (ctx.get("brand_hint") or "").strip() or (ctx.get("domain_hint") or "").strip())


def _is_enrichment_needed(df: pd.DataFrame) -> bool:
    """Enrichment is needed only if category/sub-category has missing values."""
    if "category" not in df.columns or "sub_category" not in df.columns:
        return True
    cat_missing = df["category"].fillna("").astype(str).str.strip().eq("").any()
    sub_missing = df["sub_category"].fillna("").astype(str).str.strip().eq("").any()
    return bool(cat_missing or sub_missing)


def _load_context_memory() -> List[Dict[str, str]]:
    if not CONTEXT_MEMORY_PATH.exists():
        return []
    try:
        text = CONTEXT_MEMORY_PATH.read_text(encoding="utf-8").strip()
        if not text:
            return []
        data = json.loads(text)
        if isinstance(data, list):
            return [d for d in data if isinstance(d, dict)]
        return []
    except Exception:
        return []


def _save_context_memory(entries: List[Dict[str, str]]) -> None:
    try:
        CONTEXT_MEMORY_PATH.write_text(json.dumps(entries, ensure_ascii=True, indent=2), encoding="utf-8")
    except Exception:
        pass


def _normalize_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _remember_context(ctx: Dict[str, str]) -> None:
    seller = str(ctx.get("seller_name", "")).strip()
    brand = str(ctx.get("brand_hint", "")).strip()
    domain = str(ctx.get("domain_hint", "")).strip()
    market = str(ctx.get("market_hint", "")).strip()
    if not (seller or brand or domain):
        return

    key = _normalize_key(f"{seller}|{brand}")
    entries = _load_context_memory()
    updated = False
    for e in entries:
        if _normalize_key(str(e.get("key", ""))) == key:
            if seller:
                e["seller_name"] = seller
            if brand:
                e["brand_hint"] = brand
            if domain:
                e["domain_hint"] = domain
            if market:
                e["market_hint"] = market
            e["uses"] = int(e.get("uses", 0)) + 1
            updated = True
            break
    if not updated:
        entries.append({
            "key": key,
            "seller_name": seller,
            "brand_hint": brand,
            "domain_hint": domain,
            "market_hint": market,
            "uses": 1,
        })
    # Keep frequent entries first, cap size.
    entries = sorted(entries, key=lambda e: int(e.get("uses", 0)), reverse=True)[:200]
    _save_context_memory(entries)


def _suggest_context_from_memory(inferred: Dict[str, str]) -> Optional[Dict[str, str]]:
    entries = _load_context_memory()
    if not entries:
        return None

    seller_inf = _normalize_key(str(inferred.get("seller_name", "")))
    brand_inf = _normalize_key(str(inferred.get("brand_hint", "")))
    best: Optional[Dict[str, str]] = None
    best_score = 0
    for e in entries:
        seller_e = _normalize_key(str(e.get("seller_name", "")))
        brand_e = _normalize_key(str(e.get("brand_hint", "")))
        score = 0
        if seller_inf and seller_e and (seller_inf in seller_e or seller_e in seller_inf):
            score += 3
        if brand_inf and brand_e and (brand_inf in brand_e or brand_e in brand_inf):
            score += 2
        if score > best_score:
            best_score = score
            best = e

    if best and best_score >= 2:
        return {
            "seller_name": str(best.get("seller_name", "")),
            "brand_hint": str(best.get("brand_hint", "")),
            "domain_hint": str(best.get("domain_hint", "")),
            "market_hint": str(best.get("market_hint", "")),
        }
    return None
