from __future__ import annotations

from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class SheetInfo(BaseModel):
    headers: List[str]
    sample_rows: List[Dict[str, Any]]
    row_count: int
    column_count: int


class UploadResponse(BaseModel):
    file_id: str
    original_filename: str
    file_type: str
    sheet_count: int
    sheet_names: List[str]
    sheets: Dict[str, SheetInfo]


class MappingPayload(BaseModel):
    file_id: str
    sheet_name: str
    mapping: Dict[str, Optional[str]]


class WSMessage(BaseModel):
    type: str          # "user" | "agent" | "mapping" | "preview" | "done" | "error"
    content: Any
