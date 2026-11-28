"""Public consumer tracking (US-08). Read-only, no session required.

Builds the view a consumer sees after scanning a batch QR code. It reuses the batch history service
(BPT-008) and then keeps only the fields the consumer page shows. Internal row IDs, the farmer's
identity, session data and every other database column are left out. The whitelist below is the
single definition of what the public endpoint exposes.
"""

import sqlite3
from typing import Any

from app.services.history_service import batch_history

PUBLIC_BATCH_FIELDS: tuple[str, ...] = ("batch_id", "product_name", "origin", "current_status")
# Product facts recorded when the batch was registered. They are shown to consumers, and nothing else
# from the batch row (for example the farmer's account) is.
PUBLIC_PRODUCT_FIELDS: tuple[str, ...] = ("description", "quantity", "unit", "harvest_date")
PUBLIC_EVENT_FIELDS: tuple[str, ...] = (
    "event_type",
    "label",
    "actor_role",
    "status",
    "note",
    "timestamp",
    "ledger_block_index",
)


def public_tracking(conn: sqlite3.Connection, batch_code: str) -> dict[str, Any] | None:
    """The public tracking view of one batch, or None if no batch has this ID."""
    history = batch_history(conn, batch_code)
    if history is None:
        return None
    product = conn.execute(
        "SELECT description, quantity, unit, harvest_date FROM product_batches WHERE batch_code = ?",
        (batch_code,),
    ).fetchone()
    batch = {field: history["batch"][field] for field in PUBLIC_BATCH_FIELDS}
    batch.update({field: product[field] for field in PUBLIC_PRODUCT_FIELDS})
    return {
        "batch": batch,
        "count": history["count"],
        "events": [{field: event[field] for field in PUBLIC_EVENT_FIELDS} for event in history["events"]],
    }
