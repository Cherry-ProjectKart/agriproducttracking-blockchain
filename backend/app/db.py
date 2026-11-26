"""SQLite connection management and schema initialisation."""

import sqlite3
from pathlib import Path

from flask import Flask, current_app, g

from app.migrations import complete_product_batches_upgrade, retire_outdated_product_batches
from app.services.access_service import seed_demo_users

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

EXPECTED_TABLES = ("users", "product_batches", "supply_chain_events", "ledger_blocks")


def connect(database_path: str) -> sqlite3.Connection:
    """Open a SQLite connection with foreign keys enforced and rows accessible by name."""
    conn = sqlite3.connect(database_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db() -> sqlite3.Connection:
    """Return the request-scoped database connection, opening it on first use."""
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE_PATH"])
    return g.db


def close_db(_error: BaseException | None = None) -> None:
    """Close the request-scoped connection, if one was opened."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(database_path: str) -> list[str]:
    """Create the database file (if needed), upgrade older tables, apply the schema and seed demo accounts.

    Returns the table names. Safe to run repeatedly; existing rows are preserved.
    """
    Path(database_path).parent.mkdir(parents=True, exist_ok=True)
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = connect(database_path)
    try:
        retire_outdated_product_batches(conn)
        conn.executescript(schema)
        complete_product_batches_upgrade(conn)
        seed_demo_users(conn)
        conn.commit()
    finally:
        conn.close()
    return list_tables(database_path)


def list_tables(database_path: str) -> list[str]:
    """Return the names of user tables present in the database."""
    conn = connect(database_path)
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        return [row["name"] for row in rows]
    finally:
        conn.close()


def check_database(database_path: str) -> dict[str, object]:
    """Report whether the database is reachable and whether the expected schema exists.

    Never creates the database file: a missing file is reported as not initialised.
    """
    if not Path(database_path).is_file():
        return {"status": "disconnected", "schema_initialized": False, "reason": "database file not found"}
    try:
        conn = connect(database_path)
        try:
            conn.execute("SELECT 1").fetchone()
            present = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return {"status": "disconnected", "schema_initialized": False, "reason": str(exc)}
    schema_ok = all(table in present for table in EXPECTED_TABLES)
    return {"status": "connected", "schema_initialized": schema_ok}


def register_db(app: Flask) -> None:
    """Attach connection teardown to the application."""
    app.teardown_appcontext(close_db)
