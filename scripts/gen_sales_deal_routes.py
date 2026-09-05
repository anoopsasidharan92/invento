"""One-off generator: builds backend/sales_deal_routes.py from pollen routes in main.py."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
main = (ROOT / "backend" / "main.py").read_text()
lines = main.splitlines(keepends=True)
chunk = "".join(lines[236:1528])  # lines 237–1528

chunk = chunk.replace("POLLEN_DIR", "SD_DIR")
chunk = chunk.replace("POLLEN_PROJECTS_DIR", "SD_PROJECTS_DIR")
chunk = chunk.replace("POLLEN_PROJECTS_FILE", "SD_PROJECTS_FILE")
chunk = chunk.replace("_pollen_", "_sd_")
chunk = chunk.replace("@app.", "@router.")
chunk = chunk.replace('"/pollen/', '"/sales-deals/')
chunk = chunk.replace("pollen_env", "sd_env")
chunk = chunk.replace("leads.json", "deals.json")
chunk = chunk.replace("_sd_load_leads", "_sd_load_deals")
chunk = chunk.replace("_sd_save_leads", "_sd_save_deals")

chunk = re.sub(r"^def pollen_", "def sd_", chunk, flags=re.MULTILINE)
chunk = re.sub(r"^async def pollen_", "async def sd_", chunk, flags=re.MULTILINE)

# REST paths: leads → deals
chunk = chunk.replace('"/sales-deals/{pid}/leads"', '"/sales-deals/{pid}/deals"')
chunk = chunk.replace("\"/sales-deals/{pid}/leads/", '"/sales-deals/{pid}/deals/')
chunk = chunk.replace("/leads/starred", "/deals/starred")
chunk = chunk.replace("/leads/{lid}", "/deals/{lid}")
chunk = chunk.replace("/leads/manual", "/deals/manual")

header = '''"""Sales Deal Agent — API routes (parallel to Pollen BD)."""
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

'''

out = ROOT / "backend" / "sales_deal_routes.py"
out.write_text(header + chunk)
print(f"Wrote {out} ({len(out.read_text())} chars)")
