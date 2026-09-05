"""
Optional PostgreSQL sync for BD and Real Estate agents.

Set POSTGRES_URL (e.g. postgresql+psycopg2://user:pass@host:5432/dbname) to mirror
each saved lead/listing into Postgres. If unset, sync is a no-op.

Tables are created automatically on first use: bd_agent_leads, re_agent_listings, sales_deal_agent_deals.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_engine = None
_init_lock = threading.Lock()
_metadata = None
_bd_leads_t = None
_re_listings_t = None
_sales_deals_t = None


def _try_load_dotenv(project_dir: Path) -> None:
    try:
        from dotenv import load_dotenv

        repo_root = Path(__file__).resolve().parent
        load_dotenv(repo_root / ".env")
        load_dotenv(project_dir / ".env")
        if project_dir.parent.is_dir():
            load_dotenv(project_dir.parent / ".env")
    except ImportError:
        pass


def _get_url() -> Optional[str]:
    return os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL_POSTGRES")


def _normalize_postgres_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+" not in url.split("://", 1)[0]:
        return "postgresql+psycopg2://" + url[len("postgresql://") :]
    return url


def _ensure_tables():
    global _engine, _metadata, _bd_leads_t, _re_listings_t, _sales_deals_t
    with _init_lock:
        if _bd_leads_t is not None:
            return
        from sqlalchemy import Column, DateTime, MetaData, String, Table, func
        from sqlalchemy import create_engine
        from sqlalchemy.dialects.postgresql import JSONB

        url = _get_url()
        if not url:
            return
        _engine = create_engine(_normalize_postgres_url(url), pool_pre_ping=True)
        _metadata = MetaData()
        _bd_leads_t = Table(
            "bd_agent_leads",
            _metadata,
            Column("project_id", String(128), primary_key=True),
            Column("lead_id", String(64), primary_key=True),
            Column("payload", JSONB, nullable=False),
            Column(
                "updated_at",
                DateTime(timezone=True),
                nullable=False,
                server_default=func.now(),
            ),
        )
        _re_listings_t = Table(
            "re_agent_listings",
            _metadata,
            Column("project_id", String(128), primary_key=True),
            Column("listing_id", String(64), primary_key=True),
            Column("payload", JSONB, nullable=False),
            Column(
                "updated_at",
                DateTime(timezone=True),
                nullable=False,
                server_default=func.now(),
            ),
        )
        _sales_deals_t = Table(
            "sales_deal_agent_deals",
            _metadata,
            Column("project_id", String(128), primary_key=True),
            Column("deal_id", String(64), primary_key=True),
            Column("payload", JSONB, nullable=False),
            Column(
                "updated_at",
                DateTime(timezone=True),
                nullable=False,
                server_default=func.now(),
            ),
        )
        _metadata.create_all(_engine)


def project_id_from_dir(project_dir: Path) -> str:
    return project_dir.resolve().name


def sync_bd_lead(project_dir: Path, lead_id: str, lead: Dict[str, Any]) -> None:
    """Upsert one BD lead. No-op without POSTGRES_URL."""
    _try_load_dotenv(project_dir)
    if not _get_url():
        return
    try:
        _ensure_tables()
        if _bd_leads_t is None:
            return
        from sqlalchemy.dialects.postgresql import insert

        pid = project_id_from_dir(project_dir)
        stmt = insert(_bd_leads_t).values(
            project_id=pid,
            lead_id=lead_id,
            payload=lead,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["project_id", "lead_id"],
            set_={
                "payload": stmt.excluded.payload,
                "updated_at": datetime.now(timezone.utc),
            },
        )
        with _engine.begin() as conn:
            conn.execute(stmt)
    except Exception as e:
        logger.warning("PostgreSQL sync (bd_agent_leads) failed: %s", e)


def sync_re_listing(project_dir: Path, listing_id: str, listing: Dict[str, Any]) -> None:
    """Upsert one real-estate listing. No-op without POSTGRES_URL."""
    _try_load_dotenv(project_dir)
    if not _get_url():
        return
    try:
        _ensure_tables()
        if _re_listings_t is None:
            return
        from sqlalchemy.dialects.postgresql import insert

        pid = project_id_from_dir(project_dir)
        stmt = insert(_re_listings_t).values(
            project_id=pid,
            listing_id=listing_id,
            payload=listing,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["project_id", "listing_id"],
            set_={
                "payload": stmt.excluded.payload,
                "updated_at": datetime.now(timezone.utc),
            },
        )
        with _engine.begin() as conn:
            conn.execute(stmt)
    except Exception as e:
        logger.warning("PostgreSQL sync (re_agent_listings) failed: %s", e)


def sync_sales_deal(project_dir: Path, deal_id: str, deal: Dict[str, Any]) -> None:
    """Upsert one sales-deal record. No-op without POSTGRES_URL."""
    _try_load_dotenv(project_dir)
    if not _get_url():
        return
    try:
        _ensure_tables()
        if _sales_deals_t is None:
            return
        from sqlalchemy.dialects.postgresql import insert

        pid = project_id_from_dir(project_dir)
        stmt = insert(_sales_deals_t).values(
            project_id=pid,
            deal_id=deal_id,
            payload=deal,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["project_id", "deal_id"],
            set_={
                "payload": stmt.excluded.payload,
                "updated_at": datetime.now(timezone.utc),
            },
        )
        with _engine.begin() as conn:
            conn.execute(stmt)
    except Exception as e:
        logger.warning("PostgreSQL sync (sales_deal_agent_deals) failed: %s", e)
