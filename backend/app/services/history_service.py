"""Batch history (US-07). Read-only.

Returns the supported events recorded for one batch, in a fixed order:
event timestamp first, then event id. Each event shows the ledger block that records it, when there is one.
Only events whose batch_id is the requested batch are returned. Batches are matched by their public batch ID.
"""

import sqlite3
from typing import Any

from app.models.receipt import RECEIPT_EVENT_TYPE
from app.models.shipment import SHIPMENT_EVENT_TYPE
from app.services.ledger_service import REGISTRATION_EVENT_TYPE

SUPPORTED_HISTORY_EVENT_TYPES: tuple[str, ...] = (
    REGISTRATION_EVENT_TYPE,
    SHIPMENT_EVENT_TYPE,
    RECEIPT_EVENT_TYPE,
)

_HISTORY_LABELS = {
    REGISTRATION_EVENT_TYPE: "Registration",
    SHIPMENT_EVENT_TYPE: "Shipment",
    RECEIPT_EVENT_TYPE: "Receipt",
}


def batch_history(conn: sqlite3.Connection, batch_code: str) -> dict[str, Any] | None:
    """The batch and its chronological event history, or None if no batch has this ID."""
    batch = conn.execute(
        "SELECT id, batch_code, product_name, current_status FROM product_batches WHERE batch_code = ?",
        (batch_code,),
    ).fetchone()
    if batch is None:
        return None

    placeholders = ", ".join("?" for _ in SUPPORTED_HISTORY_EVENT_TYPES)
    rows = conn.execute(
        f"""
        SELECT e.id AS event_id, e.event_type, e.actor_role, e.status, e.note,
               e.event_timestamp, l.block_index
        FROM supply_chain_events e
        LEFT JOIN ledger_blocks l ON l.event_id = e.id
        WHERE e.batch_id = ? AND e.event_type IN ({placeholders})
        ORDER BY e.event_timestamp ASC, e.id ASC
        """,
        (batch["id"], *SUPPORTED_HISTORY_EVENT_TYPES),
    ).fetchall()

    events = [
        {
            "event_id": row["event_id"],
            "event_type": row["event_type"],
            "label": _HISTORY_LABELS[row["event_type"]],
            "actor_role": row["actor_role"],
            "status": row["status"],
            "note": row["note"],
            "timestamp": row["event_timestamp"],
            "ledger_block_index": row["block_index"],
        }
        for row in rows
    ]
    return {
        "batch": {
            "batch_id": batch["batch_code"],
            "product_name": batch["product_name"],
            "current_status": batch["current_status"],
        },
        "count": len(events),
        "events": events,
    }
