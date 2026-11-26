"""Distributor shipment updates (US-05).

A shipment update does three things in one SQLite transaction:
1. sets product_batches.current_status to the new status,
2. inserts a SHIPMENT_UPDATED row in supply_chain_events,
3. appends the matching block to the local ledger (app/services/ledger_service.py).

If any step fails, all three are rolled back. A repeated request with the same Idempotency-Key
returns the existing shipment and writes nothing.
"""

import re
import sqlite3
from typing import Any

from app.models.shipment import (
    NOTE_MAX_LENGTH,
    SHIPMENT_ACTOR_ROLE,
    SHIPMENT_EVENT_TYPE,
    SHIPMENT_STATUSES,
)
from app.services.batch_identifiers import is_valid_batch_id
from app.services.ledger_service import append_block, get_block_for_event, shipment_event_data, utc_timestamp

_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
_BATCH_COLUMNS = "b.batch_code AS batch_id, b.product_name, b.origin, b.quantity, b.unit, b.harvest_date, b.current_status, b.created_at"


class ShipmentValidationError(ValueError):
    """Raised when a shipment payload fails validation. details maps field name to message."""

    def __init__(self, details: dict[str, str]):
        super().__init__("Shipment validation failed.")
        self.details = details


class ShipmentConflictError(Exception):
    """Raised when a submission key is reused for a different shipment."""


class ShipmentBatchNotFoundError(LookupError):
    """Raised when no batch has the given batch ID."""


def distributor_exists(conn: sqlite3.Connection, user_id: int) -> bool:
    """True when the user exists and has the distributor role (checked in the database)."""
    return conn.execute(
        "SELECT 1 FROM users WHERE id = ? AND role = 'distributor'", (user_id,)
    ).fetchone() is not None


def validate_shipment_input(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate a shipment payload. Only batch_id, status and note are read; other keys are ignored."""
    details: dict[str, str] = {}

    batch_id = payload.get("batch_id")
    if batch_id is None or (isinstance(batch_id, str) and not batch_id.strip()):
        details["batch_id"] = "Select a batch to update."
    elif not is_valid_batch_id(batch_id):
        details["batch_id"] = "Batch ID must look like PB-XXXX-XXXX."

    status = payload.get("status")
    if status is None or (isinstance(status, str) and not status.strip()):
        details["status"] = "Choose a shipment status."
    elif not isinstance(status, str) or status not in SHIPMENT_STATUSES:
        details["status"] = "Choose one of: " + ", ".join(SHIPMENT_STATUSES) + "."

    note = payload.get("note")
    clean_note: str | None = None
    if note is not None:
        if not isinstance(note, str):
            details["note"] = "Note must be text."
        elif _CONTROL_CHARACTERS.search(note):
            details["note"] = "Note must be a single line of plain text."
        elif len(note.strip()) > NOTE_MAX_LENGTH:
            details["note"] = f"Note must be {NOTE_MAX_LENGTH} characters or fewer."
        else:
            clean_note = note.strip() or None

    if details:
        raise ShipmentValidationError(details)
    return {"batch_id": batch_id, "status": status, "note": clean_note}


def list_shipment_batches(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Every registered batch, newest first. No farmer identity is included."""
    rows = conn.execute(
        f"SELECT {_BATCH_COLUMNS} FROM product_batches b WHERE b.batch_code IS NOT NULL "
        "ORDER BY b.created_at DESC, b.id DESC"
    ).fetchall()
    return [dict(row) for row in rows]


def _shipment_response(conn: sqlite3.Connection, event_id: int) -> dict[str, Any]:
    event = conn.execute(
        """
        SELECT e.id AS event_id, e.event_timestamp, e.status, e.note, b.batch_code AS batch_id, b.current_status
        FROM supply_chain_events e
        JOIN product_batches b ON b.id = e.batch_id
        WHERE e.id = ?
        """,
        (event_id,),
    ).fetchone()
    block = get_block_for_event(conn, event_id)
    return {
        "event": {
            "event_id": event["event_id"],
            "event_type": SHIPMENT_EVENT_TYPE,
            "actor_role": SHIPMENT_ACTOR_ROLE,
            "batch_id": event["batch_id"],
            "status": event["status"],
            "note": event["note"],
            "timestamp": event["event_timestamp"],
        },
        "batch": {"batch_id": event["batch_id"], "current_status": event["current_status"]},
        "ledger_block": {
            "index": block["index"],
            "block_hash": block["block_hash"],
            "previous_hash": block["previous_hash"],
        },
    }


def _find_by_request_key(conn: sqlite3.Connection, submission_key: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT e.id AS event_id, e.status, e.note, b.batch_code AS batch_id
        FROM supply_chain_events e
        JOIN product_batches b ON b.id = e.batch_id
        WHERE e.client_request_id = ?
        """,
        (submission_key,),
    ).fetchone()


def _same_shipment(row: sqlite3.Row, clean: dict[str, Any]) -> bool:
    return (
        row["batch_id"] == clean["batch_id"]
        and row["status"] == clean["status"]
        and row["note"] == clean["note"]
    )


def record_shipment(
    conn: sqlite3.Connection, submission_key: str, clean: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Record a shipment update atomically. Returns (result, created).

    created is False when the same submission key was already recorded with the same details;
    the stored result is returned and nothing is written. Raises ShipmentBatchNotFoundError for an
    unknown batch ID, and ShipmentConflictError when the key was used for different details.
    """
    existing = _find_by_request_key(conn, submission_key)
    if existing is not None:
        if not _same_shipment(existing, clean):
            raise ShipmentConflictError("This submission key was already used for a different shipment.")
        return _shipment_response(conn, existing["event_id"]), False

    batch = conn.execute(
        "SELECT id, batch_code FROM product_batches WHERE batch_code = ?", (clean["batch_id"],)
    ).fetchone()
    if batch is None:
        raise ShipmentBatchNotFoundError(clean["batch_id"])

    try:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        timestamp = utc_timestamp()
        conn.execute(
            "UPDATE product_batches SET current_status = ? WHERE id = ?",
            (clean["status"], batch["id"]),
        )
        event_cursor = conn.execute(
            """
            INSERT INTO supply_chain_events
                (batch_id, event_type, actor_role, status, note, event_timestamp, client_request_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                batch["id"],
                SHIPMENT_EVENT_TYPE,
                SHIPMENT_ACTOR_ROLE,
                clean["status"],
                clean["note"],
                timestamp,
                submission_key,
            ),
        )
        event_id = event_cursor.lastrowid
        append_block(
            conn,
            shipment_event_data(
                event_id=event_id,
                batch_id=batch["batch_code"],
                status=clean["status"],
                note=clean["note"],
                event_timestamp=timestamp,
            ),
            event_id,
            timestamp=timestamp,
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        # Another request with the same key may have won the race; return its result if it matches.
        raced = _find_by_request_key(conn, submission_key)
        if raced is None:
            raise
        if not _same_shipment(raced, clean):
            raise ShipmentConflictError("This submission key was already used for a different shipment.")
        return _shipment_response(conn, raced["event_id"]), False
    except Exception:
        conn.rollback()
        raise

    return _shipment_response(conn, event_id), True
