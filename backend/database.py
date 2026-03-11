from __future__ import annotations

import json
from datetime import datetime
from typing import Dict, List
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, create_engine
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = "sqlite:///./inventory.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class InventorySession(Base):
    __tablename__ = "inventory_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    original_filename = Column(String)
    file_type = Column(String)
    sheet_name = Column(String)
    column_mapping = Column(Text)          # JSON string
    row_count = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    output_path = Column(String, nullable=True)


class InventoryRow(Base):
    __tablename__ = "inventory_rows"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, index=True)
    row_data = Column(Text)               # JSON string of {field: value}
    created_at = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def save_inventory(db, session_id: str, filename: str, file_type: str,
                   sheet_name: str, mapping: Dict, rows: List[Dict],
                   output_path: str) -> InventorySession:
    session_record = InventorySession(
        session_id=session_id,
        original_filename=filename,
        file_type=file_type,
        sheet_name=sheet_name,
        column_mapping=json.dumps(mapping),
        row_count=len(rows),
        output_path=output_path,
    )
    db.add(session_record)

    for row in rows:
        db.add(InventoryRow(
            session_id=session_id,
            row_data=json.dumps(row),
        ))
    db.commit()
    db.refresh(session_record)
    return session_record
