"""Independent ledger integrity verification (US-07). Read-only.

The verifier reads every row of ledger_blocks and recalculates what it can. It never trusts a stored
hash: each block hash is recomputed from the block's stored contents with the BPT-005 algorithm
(ledger_service.compute_block_hash), and the previous-hash links are checked against those recomputed
hashes. Nothing is written, repaired or appended. The verifier runs with PRAGMA query_only enabled.

Checks, in the order they run:
  genesis             block 0 has the documented timestamp, event data and zero previous hash
  sequence            block indexes are 0, 1, 2, ... with no gaps, repeats or reordering
  canonical_data      stored event data is valid JSON in canonical form (the form that is hashed)
  timestamps          timestamps use the stored format (UTC, milliseconds, Z)
  hash_format         stored hashes are 64 lowercase hexadecimal characters
  previous_hash_links each block's previous hash equals the recalculated hash of the block before it
  block_hashes        each stored block hash equals the recalculated hash
  event_references    a block that names a supply-chain event refers to a real event with the same type, batch and id
  event_coverage      every supported supply-chain event has exactly one block
"""

import json
import re
import sqlite3
from typing import Any

from app.services.ledger_service import (
    GENESIS_EVENT_DATA,
    GENESIS_INDEX,
    GENESIS_PREVIOUS_HASH,
    GENESIS_TIMESTAMP,
    canonical_json,
    compute_block_hash,
    utc_timestamp,
)

SUPPORTED_EVENT_TYPES = ("PRODUCT_REGISTERED", "SHIPMENT_UPDATED", "RECEIPT_CONFIRMED")

CHECK_NAMES = {
    "genesis": "Genesis block",
    "sequence": "Sequential block indexes",
    "canonical_data": "Canonical event data",
    "timestamps": "Timestamp format",
    "hash_format": "Hash format",
    "previous_hash_links": "Previous-hash links",
    "block_hashes": "Block hashes recalculated",
    "event_references": "Event references",
    "event_coverage": "Every supported event has a block",
}

_TIMESTAMP_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$")
_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def verify_ledger(conn: sqlite3.Connection) -> dict[str, Any]:
    """Recalculate and check the whole ledger. Returns the verification result.

    result is "valid" only when no check fails. Failures list the block index (None when the problem is
    not tied to one block), the check name and a reason.
    """
    previous_query_only = conn.execute("PRAGMA query_only").fetchone()[0]
    conn.execute("PRAGMA query_only = 1")
    try:
        return _verify(conn)
    finally:
        conn.execute(f"PRAGMA query_only = {int(previous_query_only)}")


def _verify(conn: sqlite3.Connection) -> dict[str, Any]:
    blocks = conn.execute(
        "SELECT id, block_index, timestamp, event_payload, previous_hash, block_hash, event_id "
        "FROM ledger_blocks ORDER BY block_index ASC, id ASC"
    ).fetchall()

    failures: list[dict[str, Any]] = []

    def fail(block_index: int | None, check: str, reason: str) -> None:
        failures.append({"block_index": block_index, "check": check, "reason": reason})

    if not blocks:
        fail(None, "genesis", "The ledger has no blocks. The genesis block is missing.")

    recalculated_previous: str | None = None
    recalculated_latest: str | None = None

    for position, block in enumerate(blocks):
        index = block["block_index"]
        payload = block["event_payload"]
        timestamp = block["timestamp"]
        previous_hash = block["previous_hash"]
        stored_hash = block["block_hash"]

        if index != position:
            fail(
                index,
                "sequence",
                f"Expected block index {position} at this position but found {index}. A block may be missing, repeated or out of order.",
            )

        try:
            data = json.loads(payload)
        except (TypeError, ValueError):
            data = None
            fail(index, "canonical_data", "The stored event data is not valid JSON, so the block hash cannot be recalculated.")
        if data is not None and not isinstance(data, dict):
            fail(index, "canonical_data", "The stored event data is not a JSON object.")
            data = None
        if data is not None and canonical_json(data) != payload:
            fail(
                index,
                "canonical_data",
                "The stored event data is not in canonical form. The hash is calculated over canonical data, so it cannot match.",
            )

        if not _TIMESTAMP_PATTERN.match(timestamp or ""):
            fail(index, "timestamps", f"Timestamp {timestamp!r} is not in the UTC millisecond format YYYY-MM-DDTHH:MM:SS.mmmZ.")
        for label, value in (("previous hash", previous_hash), ("block hash", stored_hash)):
            if not isinstance(value, str) or not _HASH_PATTERN.match(value):
                fail(index, "hash_format", f"The stored {label} is not 64 lowercase hexadecimal characters.")

        if position == 0:
            if timestamp != GENESIS_TIMESTAMP:
                fail(index, "genesis", f"The genesis timestamp must be {GENESIS_TIMESTAMP}.")
            if payload != canonical_json(GENESIS_EVENT_DATA):
                fail(index, "genesis", 'The genesis event data must be {"event_type":"GENESIS"}.')
            if previous_hash != GENESIS_PREVIOUS_HASH:
                fail(index, "genesis", "The genesis previous hash must be 64 zero characters.")
            if block["event_id"] is not None:
                fail(index, "genesis", "The genesis block must not reference a supply-chain event.")
            expected_previous = GENESIS_PREVIOUS_HASH
        else:
            expected_previous = recalculated_previous
            if previous_hash != expected_previous:
                fail(
                    index,
                    "previous_hash_links",
                    f"Block {index} stores previous hash {previous_hash}, but the recalculated hash of block {index - 1} is {expected_previous}.",
                )

        if index == GENESIS_INDEX and position != 0:
            fail(index, "genesis", "A second block claims index 0. Only the first block may be the genesis block.")

        recalculated = compute_block_hash(index, timestamp, payload, previous_hash)
        if stored_hash != recalculated:
            fail(
                index,
                "block_hashes",
                f"The stored block hash {stored_hash} does not match the recalculated hash {recalculated}. The block's contents or link have changed.",
            )
        recalculated_previous = recalculated
        recalculated_latest = recalculated

        if block["event_id"] is not None and data is not None:
            _check_event_reference(conn, block, data, fail)

    covered_events = {row["event_id"] for row in blocks if row["event_id"] is not None}
    for event in conn.execute(
        "SELECT id, event_type FROM supply_chain_events WHERE event_type IN (?, ?, ?) ORDER BY id",
        SUPPORTED_EVENT_TYPES,
    ).fetchall():
        if event["id"] not in covered_events:
            fail(None, "event_coverage", f"Supported event {event['id']} ({event['event_type']}) has no ledger block.")

    failed_checks = {failure["check"] for failure in failures}
    checks = {name: name not in failed_checks for name in CHECK_NAMES}
    failing_indexes = sorted({f["block_index"] for f in failures if f["block_index"] is not None})

    return {
        "result": "valid" if not failures else "invalid",
        "checked_blocks": len(blocks),
        "latest_block_index": blocks[-1]["block_index"] if blocks else None,
        "recalculated_latest_hash": recalculated_latest,
        "first_failing_block": failing_indexes[0] if failing_indexes else None,
        "checks": [
            {"id": name, "label": CHECK_NAMES[name], "passed": checks[name]}
            for name in CHECK_NAMES
        ],
        "failures": failures,
        "verified_at": utc_timestamp(),
    }


def _check_event_reference(conn: sqlite3.Connection, block: sqlite3.Row, data: dict[str, Any], fail) -> None:
    index = block["block_index"]
    event_id = block["event_id"]
    event = conn.execute(
        """
        SELECT e.id, e.event_type, b.batch_code
        FROM supply_chain_events e
        LEFT JOIN product_batches b ON b.id = e.batch_id
        WHERE e.id = ?
        """,
        (event_id,),
    ).fetchone()
    if event is None:
        fail(index, "event_references", f"The block refers to supply-chain event {event_id}, which does not exist.")
        return
    if data.get("event_id") != event_id:
        fail(index, "event_references", f"The block's event data names event {data.get('event_id')}, but the block is linked to event {event_id}.")
    if data.get("event_type") != event["event_type"]:
        fail(index, "event_references", f"The block's event type {data.get('event_type')!r} does not match event {event_id} ({event['event_type']}).")
    if data.get("batch_id") != event["batch_code"]:
        fail(index, "event_references", f"The block's batch ID {data.get('batch_id')!r} does not match the batch of event {event_id}.")
