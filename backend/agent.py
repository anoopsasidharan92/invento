from __future__ import annotations

import asyncio
import json
import re
from typing import Dict, List, Optional, Tuple

from langchain_ollama import OllamaLLM

STANDARD_FIELDS = [
    "sku",
    "description",
    "size",
    "quantity",
    "retail_price",
    "offer_price",
    "barcode",
    "links",
    "photos",
    "batch_id",
    "units_per_carton",
    "shipping_details",
]

OLLAMA_MODEL = "llama3.2"
LLM_TIMEOUT_SECONDS = 35

FIELD_ALIASES: Dict[str, List[str]] = {
    "sku": ["sku", "item code", "product code", "style code", "part number", "article"],
    "description": ["description", "product name", "title", "item name"],
    "size": ["size", "variant", "dimension", "colour/size", "color/size"],
    "quantity": ["qty", "quantity", "stock", "on hand", "inventory"],
    "retail_price": ["retail", "rrp", "msrp", "list price"],
    "offer_price": ["offer", "trade", "sale price", "discount", "wholesale", "net price"],
    "barcode": ["barcode", "ean", "upc", "gtin"],
    "links": ["url", "link", "product page", "website"],
    "photos": ["photo", "image", "picture", "thumbnail"],
    "batch_id": ["batch", "lot", "batch id", "lot id"],
    "units_per_carton": ["units per carton", "units per box", "carton", "case qty", "pack size", "inner qty"],
    "shipping_details": ["shipping", "weight", "dimension", "delivery", "courier"],
}

MAPPING_PROMPT = """\
You are an expert inventory data analyst. Map spreadsheet columns to these standard fields.

Columns with sample values:
{columns_with_samples}

Standard fields:
{standard_fields}

Rules:
- Return ONLY valid JSON object.
- Keys must be exactly: {field_keys}
- Values must be exact column names from input or null.
- Do not assign one column to multiple fields.
"""

DISCOVERY_PROMPT = """\
You already mapped standard fields. Now inspect remaining columns and keep only useful product attributes.

Remaining columns with samples:
{remaining_columns_with_samples}

Already used columns:
{already_mapped_columns}

Return ONLY valid JSON mapping of discovered_field_name -> exact_column_name.
Use snake_case field names (e.g. colour, weight_kg, supplier_ref, country_of_origin).
Return {{}} if nothing useful remains.
"""

CORRECTION_PROMPT = """\
User wants to update mapping.

Current mapping:
{current_mapping}

Available columns:
{available_columns}

Standard fields:
{standard_fields}

User request:
"{user_message}"

Return ONLY valid JSON with updated mapping.
"""

FILE_ANALYSIS_PROMPT = """\
You are an inventory data analyst. A user uploaded an inventory spreadsheet.

File details:
- File type: {file_type}
- Number of sheets: {sheet_count}
- Sheet names: {sheet_names}
- Active sheet: {sheet_name}
- Columns: {headers}
- Row count: {row_count}

Write a short 2-3 sentence friendly analysis and mention you'll map fields next.
"""


def _build_columns_with_samples(headers: List[str], sample_rows: List[dict]) -> str:
    lines = []
    for col in headers:
        samples = [str(row.get(col, "")).strip() for row in sample_rows if row.get(col)]
        sample_str = ", ".join(samples[:3]) if samples else "(empty)"
        lines.append(f'  "{col}": [{sample_str}]')
    return "{\n" + "\n".join(lines) + "\n}"


def _extract_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    return json.loads(text)


def _get_llm() -> OllamaLLM:
    return OllamaLLM(model=OLLAMA_MODEL, temperature=0)


async def _invoke_with_timeout(llm: OllamaLLM, prompt: str, timeout_s: int = LLM_TIMEOUT_SECONDS) -> str:
    loop = asyncio.get_event_loop()
    return await asyncio.wait_for(loop.run_in_executor(None, llm.invoke, prompt), timeout=timeout_s)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _heuristic_standard_mapping(sheet_info: dict) -> Dict[str, Optional[str]]:
    headers: List[str] = sheet_info["headers"]
    samples: List[dict] = sheet_info.get("sample_rows", [])
    mapping: Dict[str, Optional[str]] = {k: None for k in STANDARD_FIELDS}
    used = set()

    for field in STANDARD_FIELDS:
        aliases = FIELD_ALIASES.get(field, [])
        best_col = None
        best_score = 0
        for col in headers:
            if col in used:
                continue
            ncol = _norm(col)
            score = 0
            for a in aliases:
                na = _norm(a)
                if na and na in ncol:
                    score = max(score, len(na))
            if field == "photos" and score == 0:
                if "url" in ncol and any("image" in str(r.get(col, "")).lower() for r in samples[:3]):
                    score = 4
            if field == "links" and score == 0:
                if "url" in ncol:
                    score = 3
            if score > best_score:
                best_score = score
                best_col = col
        if best_col:
            mapping[field] = best_col
            used.add(best_col)

    return mapping


def _heuristic_discovery(remaining_headers: List[str]) -> Dict[str, str]:
    discovered: Dict[str, str] = {}
    skip_words = ["id", "row", "index", "serial no"]
    for col in remaining_headers:
        ncol = _norm(col)
        if any(w in ncol for w in skip_words):
            continue
        field = re.sub(r"[^a-z0-9]+", "_", ncol).strip("_")
        if field and field not in STANDARD_FIELDS and field not in discovered:
            discovered[field] = col
    return discovered


async def analyze_file(sheet_info: dict, file_meta: dict, sheet_name: str) -> str:
    llm = _get_llm()
    prompt = FILE_ANALYSIS_PROMPT.format(
        file_type=file_meta.get("file_type", "unknown"),
        sheet_count=file_meta.get("sheet_count", 1),
        sheet_names=", ".join(file_meta.get("sheet_names", [sheet_name])),
        sheet_name=sheet_name,
        headers=", ".join(f'"{h}"' for h in sheet_info["headers"]),
        row_count=sheet_info["row_count"],
    )
    try:
        response = await _invoke_with_timeout(llm, prompt, timeout_s=20)
        return str(response).strip()
    except Exception:
        return "I reviewed the file structure and columns. I will now map standard fields and discover any additional product attributes."


async def map_columns(sheet_info: dict) -> Tuple[Dict[str, Optional[str]], List[str]]:
    llm = _get_llm()
    headers = sheet_info["headers"]

    # Pass 1: standard mapping
    standard_mapping: Dict[str, Optional[str]]
    try:
        columns_with_samples = _build_columns_with_samples(headers, sheet_info["sample_rows"])
        prompt = MAPPING_PROMPT.format(
            columns_with_samples=columns_with_samples,
            standard_fields="\n".join(f"- {f}" for f in STANDARD_FIELDS),
            field_keys=", ".join(f'"{f}"' for f in STANDARD_FIELDS),
        )
        raw = await _invoke_with_timeout(llm, prompt)
        parsed = _extract_json(raw)
        standard_mapping = {k: None for k in STANDARD_FIELDS}
        used = set()
        for field in STANDARD_FIELDS:
            val = parsed.get(field)
            if val and val in headers and val not in used:
                standard_mapping[field] = val
                used.add(val)
    except Exception:
        standard_mapping = _heuristic_standard_mapping(sheet_info)

    used_cols = {v for v in standard_mapping.values() if v}
    remaining_headers = [h for h in headers if h not in used_cols]

    # Pass 2: discovery
    discovered_mapping: Dict[str, str] = {}
    discovered_fields: List[str] = []
    if remaining_headers:
        try:
            remaining_with_samples = _build_columns_with_samples(remaining_headers, sheet_info["sample_rows"])
            discovery_prompt = DISCOVERY_PROMPT.format(
                remaining_columns_with_samples=remaining_with_samples,
                already_mapped_columns=json.dumps(sorted(list(used_cols))),
            )
            raw_discovery = await _invoke_with_timeout(llm, discovery_prompt)
            parsed_discovery = _extract_json(raw_discovery)
            for k, v in parsed_discovery.items():
                safe = re.sub(r"[^a-z0-9_]+", "_", str(k).lower()).strip("_")
                if safe and v in remaining_headers and safe not in STANDARD_FIELDS:
                    discovered_mapping[safe] = v
        except Exception:
            discovered_mapping = _heuristic_discovery(remaining_headers)

    discovered_fields = list(discovered_mapping.keys())
    full = {**standard_mapping, **discovered_mapping}
    return full, discovered_fields


async def apply_correction(
    current_mapping: Dict[str, Optional[str]],
    discovered_fields: List[str],
    available_columns: List[str],
    user_message: str,
) -> Tuple[Dict[str, Optional[str]], List[str]]:
    llm = _get_llm()
    try:
        prompt = CORRECTION_PROMPT.format(
            current_mapping=json.dumps(current_mapping, indent=2),
            available_columns=json.dumps(available_columns),
            standard_fields=json.dumps(STANDARD_FIELDS),
            user_message=user_message,
        )
        raw = await _invoke_with_timeout(llm, prompt, timeout_s=25)
        updated = _extract_json(raw)
    except Exception:
        return current_mapping, discovered_fields

    result: Dict[str, Optional[str]] = {}
    for field in STANDARD_FIELDS:
        val = updated.get(field, current_mapping.get(field))
        result[field] = val if val in available_columns else None

    new_discovered: List[str] = []
    candidates = (set(updated.keys()) | set(current_mapping.keys())) - set(STANDARD_FIELDS)
    for field in candidates:
        safe = re.sub(r"[^a-z0-9_]+", "_", str(field).lower()).strip("_")
        val = updated.get(field, current_mapping.get(field))
        if safe and val and val in available_columns and safe not in result:
            result[safe] = val
            new_discovered.append(safe)

    return result, new_discovered


async def generate_mapping_summary(
    mapping: Dict[str, Optional[str]],
    discovered_fields: List[str],
    row_count: int,
) -> str:
    standard_mapped = [f for f in STANDARD_FIELDS if mapping.get(f)]
    standard_unmapped = [f for f in STANDARD_FIELDS if not mapping.get(f)]
    discovered_mapped = [f for f in discovered_fields if mapping.get(f)]

    parts = [f"Mapping confirmed. Found {len(standard_mapped)} of {len(STANDARD_FIELDS)} standard fields."]
    if discovered_mapped:
        parts.append(f"Discovered {len(discovered_mapped)} additional fields.")
    if standard_unmapped:
        parts.append(f"Standard fields not found: {', '.join(standard_unmapped)}.")
    parts.append(f"Applying to all {row_count} rows now...")
    return " ".join(parts)
