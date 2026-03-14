from __future__ import annotations

import os
import re as _re
import pandas as pd
from typing import Any, Dict, List, Optional


SAMPLE_ROWS = 50
HEADER_SCAN_LIMIT = 20
CONST_CURRENCY_PREFIX = "__const_currency__:"


def detect_and_parse(filepath: str) -> Dict[str, Any]:
    """
    Detect file type and extract sheet metadata, headers, and sample rows.
    Returns a dict keyed by sheet name with headers, sample_rows, and row_count.
    """
    ext = os.path.splitext(filepath)[1].lower()

    if ext == ".csv":
        return _parse_csv(filepath)
    elif ext in (".xlsx", ".xls", ".xlsm"):
        return _parse_excel(filepath, ext)
    else:
        raise ValueError(f"Unsupported file type: {ext}. Supported: CSV, XLS, XLSX, XLSM")


def _parse_csv(filepath: str) -> Dict[str, Any]:
    encodings = ["utf-8", "latin-1", "cp1252"]
    df: Optional[pd.DataFrame] = None
    for enc in encodings:
        try:
            raw_df = pd.read_csv(filepath, encoding=enc, dtype=str, header=None)
            df = _apply_inferred_header(raw_df)
            break
        except UnicodeDecodeError:
            continue
    if df is None:
        raise ValueError("Could not decode CSV file with common encodings.")

    return {
        "Sheet1": _extract_sheet_info(df),
        "_meta": {"file_type": "csv", "sheet_count": 1},
    }


def _parse_excel(filepath: str, ext: str) -> Dict[str, Any]:
    engine = "openpyxl" if ext in (".xlsx", ".xlsm") else "xlrd"
    xl = pd.ExcelFile(filepath, engine=engine)
    result: Dict[str, Any] = {
        "_meta": {
            "file_type": ext.lstrip("."),
            "sheet_count": len(xl.sheet_names),
            "sheet_names": xl.sheet_names,
        }
    }
    for sheet in xl.sheet_names:
        raw_df = xl.parse(sheet, dtype=str, header=None)
        df = _apply_inferred_header(raw_df)
        result[sheet] = _extract_sheet_info(df)
    return result


def _clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(how="all")
    df.columns = [str(c).strip() for c in df.columns]
    # Drop columns that are fully empty (including empty-string cells).
    tmp = df.apply(
        lambda col: col.astype(str).str.strip().replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})
    )
    df = df.loc[:, ~tmp.isna().all(axis=0)]
    unnamed = [c for c in df.columns if c.lower().startswith("unnamed:")]
    df = df.drop(columns=unnamed, errors="ignore")
    return df


def _normalize_header_cell(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s.lower() in {"nan", "none"}:
        return ""
    return s


def _looks_numeric(s: str) -> bool:
    return bool(_re.match(r"^\d+(\.\d+)?$", s))


def _score_header_row(cells: List[str]) -> float:
    non_empty = [c for c in cells if c]
    if len(non_empty) < 2:
        return -999.0

    unique_count = len(set(c.lower() for c in non_empty))
    numeric_only = sum(1 for c in non_empty if _looks_numeric(c))

    keywords = [
        "sku", "item", "article", "product", "name", "gender", "color", "colour",
        "size", "qty", "quantity", "stock", "mrp", "price", "offer", "barcode",
        "ean", "upc", "brand", "category", "sub", "rbu", "type", "box",
    ]
    keyword_hits = 0
    for c in non_empty:
        nc = c.lower()
        if any(k in nc for k in keywords):
            keyword_hits += 1

    # Prefer broad, text-like header rows and penalize numeric-only/meta rows.
    score = (
        2.0 * keyword_hits
        + 1.0 * len(non_empty)
        + 0.5 * unique_count
        - 1.5 * numeric_only
    )
    return score


def _dedupe_headers(headers: List[str]) -> List[str]:
    seen: Dict[str, int] = {}
    out: List[str] = []
    for i, h in enumerate(headers):
        base = _normalize_header_cell(h) or f"column_{i+1}"
        key = base.lower()
        if key not in seen:
            seen[key] = 1
            out.append(base)
        else:
            seen[key] += 1
            out.append(f"{base}_{seen[key]}")
    return out


def _infer_header_row_index(raw_df: pd.DataFrame) -> int:
    max_idx = min(len(raw_df), HEADER_SCAN_LIMIT)
    best_idx = 0
    best_score = -9999.0
    for i in range(max_idx):
        cells = [_normalize_header_cell(v) for v in raw_df.iloc[i].tolist()]
        score = _score_header_row(cells)
        if score > best_score:
            best_score = score
            best_idx = i
    return best_idx


def _apply_inferred_header(raw_df: pd.DataFrame) -> pd.DataFrame:
    if raw_df.empty:
        return _clean_dataframe(raw_df.copy())
    hdr_idx = _infer_header_row_index(raw_df)
    header_cells = [_normalize_header_cell(v) for v in raw_df.iloc[hdr_idx].tolist()]
    headers = _dedupe_headers(header_cells)

    df = raw_df.iloc[hdr_idx + 1 :].copy()
    df.columns = headers
    df = _clean_dataframe(df)
    return df


def _extract_sheet_info(df: pd.DataFrame) -> Dict[str, Any]:
    headers = list(df.columns)
    sample = df.head(SAMPLE_ROWS).fillna("").to_dict(orient="records")
    return {
        "headers": headers,
        "sample_rows": sample,
        "row_count": len(df),
        "column_count": len(headers),
    }


def load_sheet_dataframe(filepath: str, sheet: str) -> pd.DataFrame:
    """Load a full sheet/csv as a cleaned DataFrame."""
    ext = os.path.splitext(filepath)[1].lower()
    if ext == ".csv":
        raw_df = pd.read_csv(filepath, dtype=str, header=None)
    else:
        engine = "openpyxl" if ext in (".xlsx", ".xlsm") else "xlrd"
        raw_df = pd.read_excel(filepath, sheet_name=sheet, dtype=str, engine=engine, header=None)
    return _apply_inferred_header(raw_df)


# ─── Wide-format (size-as-columns) detection & unpivot ─────────────────────────

SIZE_PATTERNS = [
    # Shoe sizes
    r"^\d{1,2}$",             # 6, 7, 8, 9, 10, 11, 12
    r"^\d{1,2}UK$",           # 6UK, 7UK
    r"^UK\s?\d{1,2}$",        # UK 6, UK7
    r"^US\s?\d{1,2}\.?\d?$",  # US 8, US8.5
    r"^EU\s?\d{2}$",          # EU 42
    # Apparel sizes
    r"^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)$",
    # Weight/volume sizes
    r"^\d+\s?(ml|ML|gm|GM|g|kg|oz|OZ|ltr|LTR|L)$",
]


def _looks_like_size(col_name: str) -> bool:
    """Check if a column name looks like a size value."""
    col = str(col_name).strip()
    return any(_re.match(p, col, _re.IGNORECASE) for p in SIZE_PATTERNS)


def _values_look_numeric(sample_rows: List[dict], col: str) -> bool:
    """Check if sample values in a column are mostly numeric (quantities)."""
    vals = [str(row.get(col, "")).strip() for row in sample_rows if row.get(col)]
    if not vals:
        return False
    numeric_count = sum(1 for v in vals if _re.match(r"^\d+\.?\d*$", v))
    return numeric_count >= len(vals) * 0.5


def detect_wide_format(sheet_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Detect if the sheet uses a wide format where sizes are spread as columns.
    Returns detection info dict if wide format found, None otherwise.
    """
    headers = sheet_info["headers"]
    samples = sheet_info["sample_rows"]

    size_cols: List[str] = []
    non_size_cols: List[str] = []

    for col in headers:
        if _looks_like_size(col) and _values_look_numeric(samples, col):
            size_cols.append(col)
        else:
            non_size_cols.append(col)

    # Need at least 2 consecutive size-like columns to consider it wide format
    if len(size_cols) < 2:
        return None

    # Verify size columns are roughly consecutive in the header list
    indices = [headers.index(c) for c in size_cols]
    gaps = [indices[i+1] - indices[i] for i in range(len(indices)-1)]
    if any(g > 2 for g in gaps):
        return None

    return {
        "is_wide": True,
        "size_columns": size_cols,
        "non_size_columns": non_size_cols,
        "size_count": len(size_cols),
        "sample_sizes": size_cols[:6],
    }


def unpivot_wide_format(
    filepath: str,
    sheet: str,
    size_columns: List[str],
) -> pd.DataFrame:
    """
    Unpivot a wide-format sheet: melt size columns into rows.
    Each size column becomes a row with (size, quantity).
    """
    df = load_sheet_dataframe(filepath, sheet)

    id_cols = [c for c in df.columns if c not in size_columns]

    melted = df.melt(
        id_vars=id_cols,
        value_vars=size_columns,
        var_name="_size",
        value_name="_qty",
    )

    # Drop rows where quantity is empty/zero (no stock in that size)
    melted["_qty"] = melted["_qty"].fillna("").astype(str).str.strip()
    melted = melted[melted["_qty"] != ""]
    melted = melted[melted["_qty"] != "0"]
    melted = melted[melted["_qty"] != "0.0"]

    # Filter out summary/total rows (e.g. "Grand Total")
    SUMMARY_KEYWORDS = ["grand total", "total", "subtotal", "sub total", "sum"]
    first_id_col = id_cols[0] if id_cols else None
    if first_id_col:
        melted = melted[
            ~melted[first_id_col].astype(str).str.strip().str.lower().isin(SUMMARY_KEYWORDS)
        ]

    melted = melted.reset_index(drop=True)
    return melted


def get_unpivoted_sheet_info(df: pd.DataFrame) -> Dict[str, Any]:
    """Extract sheet info from an already-unpivoted DataFrame."""
    headers = list(df.columns)
    sample = df.head(SAMPLE_ROWS).fillna("").to_dict(orient="records")
    return {
        "headers": headers,
        "sample_rows": sample,
        "row_count": len(df),
        "column_count": len(headers),
    }


def apply_mapping(filepath: str, sheet: str, mapping: Dict[str, Optional[str]],
                   pre_loaded_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """
    Load the full sheet and rename columns according to the mapping.
    Returns a DataFrame with only the mapped standard fields as columns.
    If pre_loaded_df is given (e.g. from unpivot), use that instead of reading the file.
    """
    if pre_loaded_df is not None:
        df = pre_loaded_df.copy()
    else:
        df = load_sheet_dataframe(filepath, sheet)

    rename: Dict[str, str] = {}
    keep: List[str] = []
    for standard_field, original_col in mapping.items():
        if original_col and original_col in df.columns:
            rename[original_col] = standard_field
            keep.append(standard_field)
        elif (
            standard_field == "local_currency"
            and isinstance(original_col, str)
            and original_col.startswith(CONST_CURRENCY_PREFIX)
        ):
            const_currency = original_col[len(CONST_CURRENCY_PREFIX):].strip().upper()
            if const_currency:
                df[standard_field] = const_currency
                keep.append(standard_field)

    df = df.rename(columns=rename)
    existing = [c for c in keep if c in df.columns]
    return df[existing]


def _to_numeric_series(series: pd.Series) -> pd.Series:
    """Convert mixed currency/text cells into numeric values where possible."""
    cleaned = (
        series.fillna("")
        .astype(str)
        .str.replace(r"[^\d\.\-]", "", regex=True)
        .str.strip()
    )
    cleaned = cleaned.replace({"": pd.NA, ".": pd.NA, "-": pd.NA})
    return pd.to_numeric(cleaned, errors="coerce")


def auto_calculate_cartons(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cross-fill carton/unit quantities when 2 of 3 values are present.
      total_carton = quantity_in_units / units_per_carton
      quantity_in_units = total_carton * units_per_carton
    Keeps any existing non-empty values unchanged.
    """
    has_qty = "quantity_in_units" in df.columns
    has_upc = "units_per_carton" in df.columns
    has_tc = "total_carton" in df.columns

    if sum([has_qty, has_upc, has_tc]) < 2:
        return df

    result = df.copy()
    for col in ("quantity_in_units", "units_per_carton", "total_carton"):
        if col not in result.columns:
            result[col] = ""

    qty = _to_numeric_series(result["quantity_in_units"])
    upc = _to_numeric_series(result["units_per_carton"])
    tc = _to_numeric_series(result["total_carton"])

    def _is_empty(series: pd.Series) -> pd.Series:
        return series.fillna("").astype(str).str.strip().eq("")

    qty_empty = _is_empty(result["quantity_in_units"])
    upc_empty = _is_empty(result["units_per_carton"])
    tc_empty = _is_empty(result["total_carton"])

    # total_carton = quantity_in_units / units_per_carton
    fill_tc = tc_empty & ~qty_empty & ~upc_empty & qty.notna() & upc.gt(0)
    computed_tc = (qty / upc).round(2)
    result.loc[fill_tc, "total_carton"] = computed_tc[fill_tc].astype(str)

    # quantity_in_units = total_carton * units_per_carton
    fill_qty = qty_empty & ~tc_empty & ~upc_empty & tc.notna() & upc.notna()
    computed_qty = (tc * upc).round(0).astype("Int64")
    result.loc[fill_qty, "quantity_in_units"] = computed_qty[fill_qty].astype(str)

    # units_per_carton = quantity_in_units / total_carton
    fill_upc = upc_empty & ~qty_empty & ~tc_empty & qty.notna() & tc.gt(0)
    computed_upc = (qty / tc).round(2)
    result.loc[fill_upc, "units_per_carton"] = computed_upc[fill_upc].astype(str)

    return result


def auto_calculate_discount(df: pd.DataFrame) -> pd.DataFrame:
    """
    Auto-fill discount (%) when retail and asking prices are available.
    Keeps any existing non-empty discount values unchanged.
    Formula: ((retail - asking) / retail) * 100
    """
    if "retail_price_local" not in df.columns or "asking_price_local" not in df.columns:
        return df

    result = df.copy()
    if "discount" not in result.columns:
        result["discount"] = ""

    retail_num = _to_numeric_series(result["retail_price_local"])
    asking_num = _to_numeric_series(result["asking_price_local"])

    computed = ((retail_num - asking_num) / retail_num) * 100.0
    # Discount makes sense only for positive retail where offer <= retail.
    valid_calc = retail_num.gt(0) & asking_num.ge(0) & asking_num.le(retail_num) & computed.notna()

    discount_existing = result["discount"].fillna("").astype(str).str.strip()
    needs_fill = discount_existing.eq("")

    fill_mask = valid_calc & needs_fill
    result.loc[fill_mask, "discount"] = computed[fill_mask].round(2).astype(str)
    return result
