from __future__ import annotations

import os
import pandas as pd
from typing import Any, Dict, List, Optional


SAMPLE_ROWS = 5


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
    df = None
    for enc in encodings:
        try:
            df = pd.read_csv(filepath, encoding=enc, dtype=str)
            break
        except UnicodeDecodeError:
            continue
    if df is None:
        raise ValueError("Could not decode CSV file with common encodings.")

    df = _clean_dataframe(df)
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
        df = xl.parse(sheet, dtype=str)
        df = _clean_dataframe(df)
        result[sheet] = _extract_sheet_info(df)
    return result


def _clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(how="all")
    df.columns = [str(c).strip() for c in df.columns]
    unnamed = [c for c in df.columns if c.lower().startswith("unnamed:")]
    df = df.drop(columns=unnamed, errors="ignore")
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


def apply_mapping(filepath: str, sheet: str, mapping: Dict[str, Optional[str]]) -> pd.DataFrame:
    """
    Load the full sheet and rename columns according to the mapping.
    Returns a DataFrame with only the mapped standard fields as columns.
    """
    ext = os.path.splitext(filepath)[1].lower()
    if ext == ".csv":
        df = pd.read_csv(filepath, dtype=str)
    else:
        engine = "openpyxl" if ext in (".xlsx", ".xlsm") else "xlrd"
        df = pd.read_excel(filepath, sheet_name=sheet, dtype=str, engine=engine)

    df = _clean_dataframe(df)

    rename: Dict[str, str] = {}
    keep: List[str] = []
    for standard_field, original_col in mapping.items():
        if original_col and original_col in df.columns:
            rename[original_col] = standard_field
            keep.append(standard_field)

    df = df.rename(columns=rename)
    existing = [c for c in keep if c in df.columns]
    return df[existing]
