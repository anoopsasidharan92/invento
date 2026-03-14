from __future__ import annotations

import asyncio
import json
import os
import re
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

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)
CONTEXT_MEMORY_PATH = Path("context_memory.json")

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


@app.get("/download/{file_id}/clean-template")
async def download_clean_template_file(file_id: str):
    path = OUTPUT_DIR / f"{file_id}_clean_template.csv"
    if not path.exists():
        raise HTTPException(404, "No clean template output file found for this session.")
    return FileResponse(str(path), media_type="text/csv", filename=path.name)


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

                await ws_send(websocket, "agent", (
                    f"Received **{session.original_filename}**. Analysing..."
                ))
                await ws_progress(websocket, "Analyzing file structure...")

                # Step 1: file analysis
                analysis = await agent.analyze_file(sheet_info, meta, session.sheet_name)
                await ws_send(websocket, "agent", analysis)
                await ws_progress(websocket, "Analysis complete", active=False)

                # Step 1.2: inventory feasibility gate
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
                if (
                    session.normalized_df is not None
                    and isinstance(row_idx, int)
                    and field in ("category", "sub_category")
                    and 0 <= row_idx < len(session.normalized_df)
                ):
                    col_loc = session.normalized_df.columns.get_loc(field)
                    session.normalized_df.iloc[row_idx, col_loc] = value
                    _save_output(session.file_id, session.normalized_df)
                    await _send_preview(websocket, session.file_id, session.normalized_df)
                continue

            # ── Confirm mapping ────────────────────────────────────────────────
            elif msg_type == "confirm_mapping":
                if "mapping" in content:
                    session.mapping = content["mapping"]
                await _apply_and_save(websocket, session, db)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await ws_send(websocket, "error", str(e))


async def _apply_and_save(websocket: WebSocket, session: ChatSession, db: Session):
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
