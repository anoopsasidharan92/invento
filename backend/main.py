from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Dict, Optional

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
import parser as inv_parser
from database import get_db, init_db, save_inventory
from schemas import UploadResponse, SheetInfo

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Inventory Parser API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


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


# ─── WebSocket Chat ─────────────────────────────────────────────────────────────

class ChatSession:
    def __init__(self):
        self.file_id: Optional[str] = None
        self.sheet_name: Optional[str] = None
        self.mapping: Optional[Dict] = None
        self.discovered_fields: list = []
        self.parsed: Optional[Dict] = None
        self.original_filename: Optional[str] = None
        self.file_type: Optional[str] = None


async def ws_send(ws: WebSocket, msg_type: str, content):
    await ws.send_text(json.dumps({"type": msg_type, "content": content}))


@app.websocket("/ws/chat")
async def chat_endpoint(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()
    session = ChatSession()

    await ws_send(websocket, "agent", (
        "Hello! I'm your Inventory Parser assistant. "
        "Please upload an Excel or CSV file to get started, and I'll analyse it for you."
    ))

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type", "user")
            content = msg.get("content", {})

            # ── File uploaded notification ──────────────────────────────────────
            if msg_type == "file_uploaded":
                session.file_id = content["file_id"]
                session.original_filename = content["original_filename"]
                session.file_type = content["file_type"]
                session.sheet_name = content.get("selected_sheet") or content["sheet_names"][0]

                # Re-parse the saved file
                ext = Path(session.original_filename).suffix.lower()
                filepath = str(UPLOAD_DIR / f"{session.file_id}{ext}")
                session.parsed = inv_parser.detect_and_parse(filepath)
                meta = session.parsed.get("_meta", {})
                sheet_info = session.parsed[session.sheet_name]

                await ws_send(websocket, "agent", (
                    f"Got it! I've received **{session.original_filename}**. "
                    f"Analysing the structure now..."
                ))

                analysis = await agent.analyze_file(sheet_info, meta, session.sheet_name)
                await ws_send(websocket, "agent", analysis)

                await ws_send(websocket, "agent",
                    "Mapping columns to standard fields and discovering extras...")
                session.mapping, session.discovered_fields = await agent.map_columns(sheet_info)

                disc_count = len(session.discovered_fields)
                if disc_count:
                    await ws_send(websocket, "agent",
                        f"Found **{disc_count}** additional field{'s' if disc_count > 1 else ''} "
                        f"beyond the standard set: {', '.join(session.discovered_fields)}. "
                        "Please review the full mapping below.")

                await ws_send(websocket, "mapping", {
                    "mapping": session.mapping,
                    "discovered_fields": session.discovered_fields,
                    "available_columns": sheet_info["headers"],
                    "sheet_name": session.sheet_name,
                })

            # ── User typed a chat message ───────────────────────────────────────
            elif msg_type == "user":
                text: str = content.get("text", "").strip()
                if not text:
                    continue

                if session.mapping is None:
                    await ws_send(websocket, "agent",
                        "Please upload a file first so I can start parsing it.")
                    continue

                # Detect confirmation
                affirmatives = {"yes", "confirm", "ok", "looks good", "correct",
                                "confirmed", "proceed", "apply", "go ahead", "done",
                                "perfect", "great", "sure", "yep", "yeah"}
                if any(text.lower().startswith(w) for w in affirmatives) or \
                   text.lower() in affirmatives:
                    await _apply_and_save(websocket, session, db)
                else:
                    # Treat as a correction request
                    sheet_info = session.parsed[session.sheet_name]
                    await ws_send(websocket, "agent", "Updating the mapping...")
                    session.mapping, session.discovered_fields = await agent.apply_correction(
                        session.mapping,
                        session.discovered_fields,
                        sheet_info["headers"],
                        text,
                    )
                    await ws_send(websocket, "mapping", {
                        "mapping": session.mapping,
                        "discovered_fields": session.discovered_fields,
                        "available_columns": sheet_info["headers"],
                        "sheet_name": session.sheet_name,
                    })

            # ── User confirmed the mapping card ────────────────────────────────
            elif msg_type == "confirm_mapping":
                if "mapping" in content:
                    session.mapping = content["mapping"]
                if "discovered_fields" in content:
                    session.discovered_fields = content["discovered_fields"]
                await _apply_and_save(websocket, session, db)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await ws_send(websocket, "error", str(e))


async def _apply_and_save(websocket: WebSocket, session: ChatSession, db: Session):
    sheet_info = session.parsed[session.sheet_name]

    summary = await agent.generate_mapping_summary(
        session.mapping, session.discovered_fields, sheet_info["row_count"]
    )
    await ws_send(websocket, "agent", summary)

    ext = Path(session.original_filename).suffix.lower()
    filepath = str(UPLOAD_DIR / f"{session.file_id}{ext}")

    df = inv_parser.apply_mapping(filepath, session.sheet_name, session.mapping)

    # Save output file
    output_path = str(OUTPUT_DIR / f"{session.file_id}_normalized.csv")
    df.to_csv(output_path, index=False)

    # Preview (first 20 rows)
    preview_rows = df.head(20).fillna("").to_dict(orient="records")
    columns = list(df.columns)

    await ws_send(websocket, "preview", {
        "columns": columns,
        "rows": preview_rows,
        "total_rows": len(df),
        "file_id": session.file_id,
    })

    # Persist to database
    rows_for_db = df.fillna("").to_dict(orient="records")
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

    mapped_count = sum(1 for v in session.mapping.values() if v)
    disc_count = len([f for f in session.discovered_fields if session.mapping.get(f)])
    await ws_send(websocket, "agent", (
        f"Done! Processed **{len(df)} rows** with **{mapped_count} fields** "
        f"({mapped_count - disc_count} standard + {disc_count} discovered). "
        f"Data saved to database. Download the CSV below."
    ))

    await ws_send(websocket, "done", {
        "file_id": session.file_id,
        "row_count": len(df),
        "mapped_fields": mapped_count,
        "discovered_fields": disc_count,
    })
