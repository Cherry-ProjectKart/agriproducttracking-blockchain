"""Local hash-linked ledger (US-04).

The ledger is a sequence of blocks in ledger_blocks. Each block stores its index, a UTC
timestamp, its event data (canonical JSON), the previous block's hash and its own SHA-256 hash.
Changing any stored block changes its hash, so the change no longer matches the hash stored
in the next block. This demonstrates tamper detection. It is not a distributed blockchain.

Hash input (exact format):
    The block hash is SHA-256 over the UTF-8 bytes of this canonical JSON text:
        {"event_data":<JSON string>,"index":<int>,"previous_hash":"<hex>","timestamp":"<ISO>"}
    <JSON string> is the stored event_payload text, encoded as a JSON string.
    Canonical JSON means sort_keys=True, separators (",", ":") and ensure_ascii=False.
    The block_hash itself is not part of the input.

Genesis convention:
    Block 0 is created before any event. Index 0, timestamp 1970-01-01T00:00:00.000Z,
    event data {"event_type":"GENESIS"}, previous hash 64 zero characters.
"""

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

GENESIS_INDEX = 0
GENESIS_TIMESTAMP = "1970-01-01T00:00:00.000Z"
GENESIS_PREVIOUS_HASH = "0" * 64
GENESIS_EVENT_DATA: dict[str, Any] = {"event_type": "GENESIS"}

REGISTRATION_EVENT_TYPE = "PRODUCT_REGISTERED"

_BLOCK_COLUMNS = "block_index, timestamp, event_payload, previous_hash, block_hash, event_id"


class LedgerError(RuntimeError):
    """Raised when a ledger operation cannot be completed. The caller's transaction must be rolled back."""


def canonical_json(data: Any) -> str:
    """Deterministic JSON text: sorted keys, no spaces, non-ASCII kept as UTF-8 characters."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def serialize_event_data(event_data: dict[str, Any]) -> str:
    """The stored form of event data. Only JSON objects are accepted."""
    if not isinstance(event_data, dict):
        raise LedgerError("Ledger event data must be a JSON object.")
    return canonical_json(event_data)


def utc_timestamp(moment: datetime | None = None) -> str:
    """UTC timestamp with millisecond precision and a Z suffix, e.g. 2026-11-26T16:40:01.123Z."""
    current = moment if moment is not None else datetime.now(timezone.utc)
    return current.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def compute_block_hash(index: int, timestamp: str, event_payload: str, previous_hash: str) -> str:
    """SHA-256 of the hash input described in the module docstring. Returns lowercase hex."""
    hash_input = canonical_json(
        {
            "event_data": event_payload,
            "index": index,
            "previous_hash": previous_hash,
            "timestamp": timestamp,
        }
    )
    return hashlib.sha256(hash_input.encode("utf-8")).hexdigest()


def registration_event_data(
    *, event_id: int, batch_id: str, product: dict[str, Any], actor_role: str = "farmer", status: str = "Registered"
) -> dict[str, Any]:
    """The event data recorded for a product registration.

    Contains only product facts and identifiers. No user names, session values or keys.
    """
    return {
        "event_type": REGISTRATION_EVENT_TYPE,
        "event_id": event_id,
        "batch_id": batch_id,
        "actor_role": actor_role,
        "status": status,
        "product_name": product["product_name"],
        "quantity": product["quantity"],
        "unit": product["unit"],
        "origin": product["origin"],
        "harvest_date": product["harvest_date"],
    }


def shipment_event_data(
    *, event_id: int, batch_id: str, status: str, note: str | None, event_timestamp: str
) -> dict[str, Any]:
    """The event data recorded for a distributor shipment update (US-05).

    The event timestamp is the same string stored in supply_chain_events.event_timestamp.
    Contains no user names, session values or keys.
    """
    return {
        "event_type": "SHIPMENT_UPDATED",
        "event_id": event_id,
        "batch_id": batch_id,
        "actor_role": "distributor",
        "status": status,
        "note": note,
        "event_timestamp": event_timestamp,
    }


def receipt_event_data(*, event_id: int, batch_id: str, status: str, event_timestamp: str) -> dict[str, Any]:
    """The event data recorded when a retailer confirms receipt (US-06).

    The actor is always the retailer role, taken from the authenticated session by the caller.
    Contains no user names, session values or keys.
    """
    return {
        "event_type": "RECEIPT_CONFIRMED",
        "event_id": event_id,
        "batch_id": batch_id,
        "actor_role": "retailer",
        "status": status,
        "event_timestamp": event_timestamp,
    }


def _block_from_row(row: sqlite3.Row | tuple) -> dict[str, Any]:
    index, timestamp, event_payload, previous_hash, block_hash, event_id = tuple(row)
    event_data = json.loads(event_payload)
    return {
        "index": index,
        "timestamp": timestamp,
        "event_type": event_data.get("event_type"),
        "event_id": event_id,
        "batch_id": event_data.get("batch_id"),
        "event_data": event_data,
        "previous_hash": previous_hash,
        "block_hash": block_hash,
    }


def get_latest_block(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT {_BLOCK_COLUMNS} FROM ledger_blocks ORDER BY block_index DESC LIMIT 1"
    ).fetchone()
    return _block_from_row(row) if row is not None else None


def get_block(conn: sqlite3.Connection, index: int) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT {_BLOCK_COLUMNS} FROM ledger_blocks WHERE block_index = ?", (index,)
    ).fetchone()
    return _block_from_row(row) if row is not None else None


def get_block_for_event(conn: sqlite3.Connection, event_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT {_BLOCK_COLUMNS} FROM ledger_blocks WHERE event_id = ?", (event_id,)
    ).fetchone()
    return _block_from_row(row) if row is not None else None


def list_blocks(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """All blocks in chronological (index) order."""
    rows = conn.execute(f"SELECT {_BLOCK_COLUMNS} FROM ledger_blocks ORDER BY block_index ASC").fetchall()
    return [_block_from_row(row) for row in rows]


def _insert_block(
    conn: sqlite3.Connection,
    index: int,
    timestamp: str,
    event_data: dict[str, Any],
    event_id: int | None,
    previous_hash: str,
) -> dict[str, Any]:
    event_payload = serialize_event_data(event_data)
    block_hash = compute_block_hash(index, timestamp, event_payload, previous_hash)
    conn.execute(
        """
        INSERT INTO ledger_blocks (block_index, timestamp, event_payload, previous_hash, block_hash, event_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (index, timestamp, event_payload, previous_hash, block_hash, event_id),
    )
    return get_block(conn, index)


def ensure_genesis(conn: sqlite3.Connection) -> dict[str, Any]:
    """Create the genesis block if the ledger is empty. Returns block 0. Does not commit."""
    existing = get_block(conn, GENESIS_INDEX)
    if existing is not None:
        return existing
    if get_latest_block(conn) is not None:
        raise LedgerError("The ledger has blocks but no genesis block; it cannot be extended safely.")
    return _insert_block(
        conn, GENESIS_INDEX, GENESIS_TIMESTAMP, GENESIS_EVENT_DATA, None, GENESIS_PREVIOUS_HASH
    )


def append_block(
    conn: sqlite3.Connection,
    event_data: dict[str, Any],
    event_id: int | None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """Append one block after the latest one, creating the genesis block first if needed.

    Does not commit: the caller commits with the event it describes, so both are stored or neither.
    Raises LedgerError if the same supply-chain event already has a block.
    """
    if event_id is not None and get_block_for_event(conn, event_id) is not None:
        raise LedgerError(f"Supply-chain event {event_id} already has a ledger block.")

    latest = get_latest_block(conn)
    if latest is None:
        latest = ensure_genesis(conn)
    return _insert_block(
        conn,
        latest["index"] + 1,
        timestamp or utc_timestamp(),
        event_data,
        event_id,
        latest["block_hash"],
    )


def backfill_registration_ledger(conn: sqlite3.Connection) -> list[int]:
    """Give each PRODUCT_REGISTERED event that has no block its own block (SRS 7.2).

    Events are processed in chronological order (event time, then event id). Each block carries
    the event's own timestamp. Events that already have a block are skipped, so running this
    again creates nothing. All blocks commit together, or none do. Returns the event ids recorded.
    """
    pending = conn.execute(
        """
        SELECT e.id AS event_id, e.event_timestamp, e.actor_role, e.status,
               b.batch_code, b.product_name, b.quantity, b.unit, b.origin, b.harvest_date
        FROM supply_chain_events e
        JOIN product_batches b ON b.id = e.batch_id
        WHERE e.event_type = ?
          AND NOT EXISTS (SELECT 1 FROM ledger_blocks l WHERE l.event_id = e.id)
        ORDER BY e.event_timestamp ASC, e.id ASC
        """,
        (REGISTRATION_EVENT_TYPE,),
    ).fetchall()
    if not pending:
        return []

    recorded: list[int] = []
    try:
        for row in pending:
            event_data = registration_event_data(
                event_id=row["event_id"],
                batch_id=row["batch_code"],
                product={
                    "product_name": row["product_name"],
                    "quantity": row["quantity"],
                    "unit": row["unit"],
                    "origin": row["origin"],
                    "harvest_date": row["harvest_date"],
                },
                actor_role=row["actor_role"],
                status=row["status"],
            )
            append_block(conn, event_data, row["event_id"], timestamp=row["event_timestamp"])
            recorded.append(row["event_id"])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return recorded
