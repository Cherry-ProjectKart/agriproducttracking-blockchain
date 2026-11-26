"""Retailer receipt confirmation (US-06).

Confirming receipt does three things in one SQLite transaction:
1. sets product_batches.current_status to "Received by Retailer" (only from "Delivered to Retailer"),
2. inserts a RECEIPT_CONFIRMED row in supply_chain_events, with the retailer as the actor,
3. appends the matching block to the local ledger (app/services/ledger_service.py).

If any step fails, all three are rolled back. The eligibility check runs inside that transaction,
so two confirmations at the same time cannot both succeed. A repeated request with the same
Idempotency-Key returns the stored receipt and writes nothing.
"""

import sqlite3
from typing import Any

from app.models.receipt import (
    AWAITING_RECEIPT_STATUS,
    RECEIPT_ACTOR_ROLE,
    RECEIPT_EVENT_TYPE,
    RECEIVED_STATUS,
)
from app.services.ledger_service import append_block, get_block_for_event, receipt_event_data, utc_timestamp


class ReceiptBatchNotFoundError(LookupError):
    """Raised when no batch has the given batch ID."""


class ReceiptNotAllowedError(Exception):
    """Raised when the batch is not in a state that allows receipt confirmation (an invalid transition)."""


class ReceiptConflictError(Exception):
    """Raised when a submission key was already used for a different batch."""


_AWAITING_COLUMNS = (
    "b.batch_code AS batch_id, b.product_name, b.origin, b.quantity, b.unit, "
    "b.harvest_date, b.current_status, b.created_at"
)


def retailer_exists(conn: sqlite3.Connection, user_id: int) -> bool:
    """True when the user exists and has the retailer role (checked in the database)."""
    return conn.execute(
        "SELECT 1 FROM users WHERE id = ? AND role = 'retailer'", (user_id,)
    ).fetchone() is not None


def list_awaiting_receipt(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Batches whose status is 'Delivered to Retailer', oldest delivery first.

    Only batch identification and status are returned. No farmer identity is included.
    """
    rows = conn.execute(
        f"""
        SELECT {_AWAITING_COLUMNS}
        FROM product_batches b
        WHERE b.batch_code IS NOT NULL AND b.current_status = ?
        ORDER BY b.created_at ASC, b.id ASC
        """,
        (AWAITING_RECEIPT_STATUS,),
    ).fetchall()
    return [dict(row) for row in rows]


def _receipt_response(conn: sqlite3.Connection, event_id: int) -> dict[str, Any]:
    event = conn.execute(
        """
        SELECT e.id AS event_id, e.event_timestamp, e.status, b.batch_code AS batch_id, b.current_status
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
            "event_type": RECEIPT_EVENT_TYPE,
            "actor_role": RECEIPT_ACTOR_ROLE,
            "batch_id": event["batch_id"],
            "status": event["status"],
            "timestamp": event["event_timestamp"],
        },
        "batch": {"batch_id": event["batch_id"], "current_status": event["current_status"]},
        "ledger_block": {
            "index": block["index"],
            "block_hash": block["block_hash"],
            "previous_hash": block["previous_hash"],
        },
    }


def _find_receipt_by_key(conn: sqlite3.Connection, submission_key: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT e.id AS event_id, b.batch_code AS batch_id
        FROM supply_chain_events e
        JOIN product_batches b ON b.id = e.batch_id
        WHERE e.client_request_id = ? AND e.event_type = ?
        """,
        (submission_key, RECEIPT_EVENT_TYPE),
    ).fetchone()


def confirm_receipt(
    conn: sqlite3.Connection, submission_key: str, batch_id: str
) -> tuple[dict[str, Any], bool]:
    """Confirm that a retailer has received a batch. Returns (result, created).

    created is False when the same submission key already confirmed this batch; the stored receipt
    is returned and nothing is written.

    Raises ReceiptBatchNotFoundError for an unknown batch ID, ReceiptNotAllowedError when the batch
    is not awaiting receipt (including an already received batch), and ReceiptConflictError when the
    key was used for a different batch.
    """
    existing = _find_receipt_by_key(conn, submission_key)
    if existing is not None:
        if existing["batch_id"] != batch_id:
            raise ReceiptConflictError("This submission key was already used for a different batch.")
        return _receipt_response(conn, existing["event_id"]), False

    try:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        batch = conn.execute(
            "SELECT id, batch_code, current_status FROM product_batches WHERE batch_code = ?", (batch_id,)
        ).fetchone()
        if batch is None:
            raise ReceiptBatchNotFoundError(batch_id)
        if batch["current_status"] != AWAITING_RECEIPT_STATUS:
            if batch["current_status"] == RECEIVED_STATUS:
                raise ReceiptNotAllowedError("This batch has already been received by a retailer.")
            raise ReceiptNotAllowedError(
                "This batch is not awaiting receipt. It must be marked Delivered to Retailer first."
            )

        timestamp = utc_timestamp()
        conn.execute(
            "UPDATE product_batches SET current_status = ? WHERE id = ?",
            (RECEIVED_STATUS, batch["id"]),
        )
        event_cursor = conn.execute(
            """
            INSERT INTO supply_chain_events
                (batch_id, event_type, actor_role, status, note, event_timestamp, client_request_id)
            VALUES (?, ?, ?, ?, NULL, ?, ?)
            """,
            (batch["id"], RECEIPT_EVENT_TYPE, RECEIPT_ACTOR_ROLE, RECEIVED_STATUS, timestamp, submission_key),
        )
        event_id = event_cursor.lastrowid
        append_block(
            conn,
            receipt_event_data(
                event_id=event_id,
                batch_id=batch["batch_code"],
                status=RECEIVED_STATUS,
                event_timestamp=timestamp,
            ),
            event_id,
            timestamp=timestamp,
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        # Another request with the same key may have won the race; return its result if it matches.
        raced = _find_receipt_by_key(conn, submission_key)
        if raced is None:
            raise
        if raced["batch_id"] != batch_id:
            raise ReceiptConflictError("This submission key was already used for a different batch.")
        return _receipt_response(conn, raced["event_id"]), False
    except Exception:
        conn.rollback()
        raise

    return _receipt_response(conn, event_id), True
