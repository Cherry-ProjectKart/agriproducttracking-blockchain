"""Ledger integrity (BPT-108): forced write failures, concurrency, tampering and read-only checks.

Every tampering test changes an isolated test database that the test itself creates. The demo
database is never modified by these tests.
"""

import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.db import connect, init_db
from app.services.batch_service import register_batch, validate_batch_input
from app.services.ledger_service import compute_block_hash
from app.services.ledger_verification import verify_ledger

from tests.auth_helpers import sign_in

VALID = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}
TABLES = ("users", "supply_chain_events", "ledger_blocks")
# Changes the recorded actor of block 2 without touching its hash. Used by the tampering tests.
ROLE_SWAP_SQL = (
    "UPDATE ledger_blocks SET event_payload = replace(event_payload, '\"actor_role\":\"distributor\"', '\"actor_role\":\"retailer\"') WHERE block_index = 2"
)


# --- Helpers ----------------------------------------------------------------------------------


def _snapshot(db_path):
    """Every row of the tables that the ledger and its records live in, in a stable order."""
    conn = sqlite3.connect(db_path)
    try:
        return {table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")] for table in TABLES}
    finally:
        conn.close()


def _run(db_path, sql, params=(), foreign_keys=True):
    conn = sqlite3.connect(db_path)
    conn.execute(f"PRAGMA foreign_keys = {'ON' if foreign_keys else 'OFF'}")
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _scalar(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        conn.close()


def _verify(db_path):
    conn = connect(db_path)
    try:
        return verify_ledger(conn)
    finally:
        conn.close()


def _failing_checks(result):
    return {failure["check"] for failure in result["failures"]}


def _install_failure(db_path, name, table, operation):
    """Make every INSERT or UPDATE on one table fail inside the request's transaction."""
    _run(db_path, f"CREATE TRIGGER {name} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, 'forced failure for test'); END")


def _remove_failure(db_path, name):
    _run(db_path, f"DROP TRIGGER IF EXISTS {name}")


def _farmer(client):
    assert sign_in(client, "farmer").status_code == 200


def _distributor(client):
    assert sign_in(client, "distributor").status_code == 200


def _retailer(client):
    assert sign_in(client, "retailer").status_code == 200


def _register(client, key=None):
    _farmer(client)
    response = client.post("/api/batches", json=VALID, headers={"Idempotency-Key": key or str(uuid.uuid4())})
    return response


def _ship(client, batch_id, status, key=None):
    _distributor(client)
    return client.post(
        "/api/shipments",
        json={"batch_id": batch_id, "status": status},
        headers={"Idempotency-Key": key or str(uuid.uuid4())},
    )


def _full_chain(client):
    """Register a batch, move it to the retailer and confirm receipt. Returns the batch ID."""
    batch_id = _register(client).get_json()["batch"]["batch_id"]
    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        assert _ship(client, batch_id, status).status_code == 201
    _retailer(client)
    assert client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": str(uuid.uuid4())}).status_code == 201
    return batch_id


# --- Genesis and block structure ----------------------------------------------------------------


def test_exactly_one_genesis_block_exists_and_it_is_block_zero(client, db_path):
    _register(client)

    assert _scalar(db_path, "SELECT COUNT(*) FROM ledger_blocks WHERE event_id IS NULL") == 1
    genesis = sqlite3.connect(db_path).execute(
        "SELECT block_index, timestamp, event_payload, previous_hash FROM ledger_blocks WHERE block_index = 0"
    ).fetchone()
    assert genesis[0] == 0
    assert genesis[1] == "1970-01-01T00:00:00.000Z"
    assert genesis[2] == '{"event_type":"GENESIS"}'
    assert genesis[3] == "0" * 64


def test_each_block_links_to_its_immediate_predecessor(client, db_path):
    _full_chain(client)

    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT block_index, previous_hash, block_hash FROM ledger_blocks ORDER BY block_index").fetchall()
    conn.close()

    assert [row[0] for row in rows] == list(range(len(rows)))
    for previous, current in zip(rows, rows[1:]):
        assert current[1] == previous[2]


def test_block_hashes_are_reproducible_from_stored_contents(client, db_path):
    _full_chain(client)

    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT block_index, timestamp, event_payload, previous_hash, block_hash FROM ledger_blocks").fetchall()
    conn.close()

    for index, timestamp, payload, previous_hash, block_hash in rows:
        assert compute_block_hash(index, timestamp, payload, previous_hash) == block_hash


# --- Forced failures roll back the whole operation -------------------------------------------


@pytest.mark.parametrize(
    "table, operation",
    [("product_batches", "INSERT"), ("supply_chain_events", "INSERT"), ("ledger_blocks", "INSERT")],
)
def test_failed_registration_stage_leaves_no_batch_event_or_block(client, db_path, table, operation):
    _farmer(client)
    before = _snapshot(db_path)
    _install_failure(db_path, "forced_registration_failure", table, operation)

    failed = client.post("/api/batches", json=VALID, headers={"Idempotency-Key": "fail0001-aaaa-4bbb-8ccc-000000000001"})

    assert failed.status_code == 500
    assert _snapshot(db_path) == before

    _remove_failure(db_path, "forced_registration_failure")
    retried = client.post("/api/batches", json=VALID, headers={"Idempotency-Key": "fail0001-aaaa-4bbb-8ccc-000000000001"})
    assert retried.status_code == 201
    assert _verify(db_path)["result"] == "valid"


@pytest.mark.parametrize(
    "table, operation",
    [("supply_chain_events", "INSERT"), ("ledger_blocks", "INSERT"), ("product_batches", "UPDATE")],
)
def test_failed_shipment_stage_leaves_status_event_and_block_unchanged(client, db_path, table, operation):
    batch_id = _register(client).get_json()["batch"]["batch_id"]
    before = _snapshot(db_path)
    _install_failure(db_path, "forced_shipment_failure", table, operation)

    failed = _ship(client, batch_id, "Shipped", key="fail0002-aaaa-4bbb-8ccc-000000000001")

    assert failed.status_code == 500
    assert _snapshot(db_path) == before
    assert _scalar(db_path, "SELECT current_status FROM product_batches WHERE batch_code = ?", (batch_id,)) == "Registered"

    _remove_failure(db_path, "forced_shipment_failure")
    assert _ship(client, batch_id, "Shipped", key="fail0002-aaaa-4bbb-8ccc-000000000001").status_code == 201
    assert _verify(db_path)["result"] == "valid"


@pytest.mark.parametrize(
    "table, operation",
    [("supply_chain_events", "INSERT"), ("ledger_blocks", "INSERT"), ("product_batches", "UPDATE")],
)
def test_failed_receipt_stage_leaves_status_event_and_block_unchanged(client, db_path, table, operation):
    batch_id = _register(client).get_json()["batch"]["batch_id"]
    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        assert _ship(client, batch_id, status).status_code == 201
    before = _snapshot(db_path)
    _install_failure(db_path, "forced_receipt_failure", table, operation)
    _retailer(client)

    failed = client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": "fail0003-aaaa-4bbb-8ccc-000000000001"})

    assert failed.status_code == 500
    assert _snapshot(db_path) == before
    assert _scalar(db_path, "SELECT current_status FROM product_batches WHERE batch_code = ?", (batch_id,)) == "Delivered to Retailer"

    _remove_failure(db_path, "forced_receipt_failure")
    retried = client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": "fail0003-aaaa-4bbb-8ccc-000000000001"})
    assert retried.status_code == 201
    assert _verify(db_path)["result"] == "valid"


# --- Events and blocks for each lifecycle operation --------------------------------------------


def test_registration_creates_one_event_and_one_block_that_reference_each_other(client, db_path):
    _register(client)

    event = sqlite3.connect(db_path).execute(
        "SELECT id, event_type, event_timestamp FROM supply_chain_events WHERE event_type = 'PRODUCT_REGISTERED'"
    ).fetchone()
    block = sqlite3.connect(db_path).execute(
        "SELECT event_id, timestamp FROM ledger_blocks WHERE event_id = ?", (event[0],)
    ).fetchone()

    assert block is not None
    assert block[0] == event[0]
    # The event and its block share one timestamp.
    assert block[1] == event[2]


def test_full_lifecycle_appends_one_block_per_recorded_event(client, db_path):
    _full_chain(client)

    events = _scalar(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type IN ('PRODUCT_REGISTERED','SHIPMENT_UPDATED','RECEIPT_CONFIRMED')")
    blocks = _scalar(db_path, "SELECT COUNT(*) FROM ledger_blocks WHERE event_id IS NOT NULL")

    assert events == blocks == 5  # registration, three shipments, receipt
    assert _verify(db_path)["result"] == "valid"


def test_repeated_requests_and_read_only_actions_leave_the_ledger_unchanged(client, db_path):
    batch_id = _full_chain(client)
    before = _snapshot(db_path)

    client.get("/api/ledger")
    client.get("/api/ledger/verify")
    client.get(f"/api/history/{batch_id}")
    client.get("/api/batches")
    client.delete("/api/session")
    client.get(f"/api/tracking/{batch_id}")
    client.get(f"/api/history/{batch_id}")  # unauthenticated: refused, still read-only

    assert _snapshot(db_path) == before


def test_description_edit_and_qr_download_create_no_ledger_record(client, db_path):
    _farmer(client)
    batch = client.post("/api/batches", json=VALID, headers={"Idempotency-Key": "edit0001-aaaa-4bbb-8ccc-000000000001"}).get_json()["batch"]
    before = _snapshot(db_path)

    assert client.patch(f"/api/batches/{batch['id']}", json={"description": "Refreshed note."}).status_code == 200
    assert client.get(batch["qr_code_url"] + "?download=1").status_code == 200

    assert _snapshot(db_path) == before


# --- Concurrency -------------------------------------------------------------------------------


def test_concurrent_registrations_keep_indexes_sequential_and_the_chain_valid(tmp_path):
    db = str(tmp_path / "concurrent.db")
    init_db(db)
    setup = connect(db)
    setup.execute("INSERT INTO users (display_name, username, role) VALUES ('Farmer', 'farmer.concurrent', 'farmer')")
    setup.commit()
    farmer_id = setup.execute("SELECT id FROM users WHERE username = 'farmer.concurrent'").fetchone()[0]
    setup.close()

    def worker(number):
        conn = connect(db)
        try:
            batch_ids = []
            for item in range(5):
                clean = validate_batch_input(dict(VALID, product_name=f"Item {number}-{item}"))
                batch, _created = register_batch(conn, farmer_id, f"conc-{number:02d}-{item:02d}-key-0001", clean)
                batch_ids.append(batch["batch_id"])
            return batch_ids
        finally:
            conn.close()

    with ThreadPoolExecutor(max_workers=4) as pool:
        batch_ids = [batch_id for future in [pool.submit(worker, n) for n in range(4)] for batch_id in future.result()]

    assert len(batch_ids) == len(set(batch_ids)) == 20

    conn = sqlite3.connect(db)
    indexes = [row[0] for row in conn.execute("SELECT block_index FROM ledger_blocks ORDER BY block_index")]
    events = conn.execute("SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'PRODUCT_REGISTERED'").fetchone()[0]
    blocks_for_events = conn.execute("SELECT COUNT(DISTINCT event_id) FROM ledger_blocks WHERE event_id IS NOT NULL").fetchone()[0]
    conn.close()

    assert indexes == list(range(21))  # genesis plus 20 registrations, with no gap or repeat
    assert events == blocks_for_events == 20
    assert _verify(db)["result"] == "valid"


# --- Tampering is detected (isolated test databases only) ----------------------------------------


@pytest.fixture
def chain(client, db_path):
    """A valid ledger with registration, three shipments and a receipt (blocks 0 to 5)."""
    _full_chain(client)
    assert _verify(db_path)["result"] == "valid"
    return db_path


def test_verification_does_not_modify_the_ledger(chain):
    before = _snapshot(chain)
    _verify(chain)
    _verify(chain)
    assert _snapshot(chain) == before


def test_altered_event_payload_is_detected(chain):
    _run(chain, ROLE_SWAP_SQL)

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert {"block_hashes", "event_consistency"} <= _failing_checks(result)
    assert result["first_failing_block"] == 2


def test_altered_block_hash_is_detected(chain):
    _run(chain, "UPDATE ledger_blocks SET block_hash = ? WHERE block_index = 2", ("f" * 64,))

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert "block_hashes" in _failing_checks(result)
    assert result["first_failing_block"] == 2


def test_altered_previous_hash_is_detected(chain):
    _run(chain, "UPDATE ledger_blocks SET previous_hash = ? WHERE block_index = 3", ("e" * 64,))

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert "previous_hash_links" in _failing_checks(result)
    assert result["first_failing_block"] == 3


def test_deleted_middle_block_is_detected(chain):
    _run(chain, "DELETE FROM ledger_blocks WHERE block_index = 2")

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert {"sequence", "previous_hash_links"} <= _failing_checks(result)


def test_deleted_last_block_is_reported_through_its_missing_event(chain):
    last = _scalar(chain, "SELECT MAX(block_index) FROM ledger_blocks")
    _run(chain, "DELETE FROM ledger_blocks WHERE block_index = ?", (last,))

    result = _verify(chain)

    # A chain cannot prove by its own links that its last block was removed. The event that
    # lost its block is what reveals it.
    assert result["result"] == "invalid"
    assert "event_coverage" in _failing_checks(result)


def test_removed_event_reference_is_detected(chain):
    _run(chain, "UPDATE ledger_blocks SET event_id = NULL WHERE block_index = 2")

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert "event_coverage" in _failing_checks(result)


def test_reference_to_a_missing_event_is_detected(chain):
    _run(chain, "UPDATE ledger_blocks SET event_id = 999999 WHERE block_index = 2", foreign_keys=False)

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert "event_references" in _failing_checks(result)


def test_event_referenced_by_two_blocks_is_detected(chain):
    # The database forbids this with a unique index. Drop the index in the test copy to show that the
    # verifier also reports it, so a damaged database is still caught.
    _run(chain, "DROP INDEX idx_ledger_blocks_event_id")
    event_of_block_2 = _scalar(chain, "SELECT event_id FROM ledger_blocks WHERE block_index = 2")
    _run(chain, "UPDATE ledger_blocks SET event_id = ? WHERE block_index = 3", (event_of_block_2,))

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert "event_uniqueness" in _failing_checks(result)


def test_altered_genesis_block_is_detected(chain):
    _run(chain, "UPDATE ledger_blocks SET timestamp = '2000-01-01T00:00:00.000Z' WHERE block_index = 0")

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert "genesis" in _failing_checks(result)


def test_event_changed_after_its_block_is_detected(chain):
    event_id = _scalar(chain, "SELECT event_id FROM ledger_blocks WHERE block_index = 2")
    _run(chain, "UPDATE supply_chain_events SET status = 'Delivered to Retailer' WHERE id = ?", (event_id,))

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert "event_consistency" in _failing_checks(result)


def test_forged_block_with_recalculated_hashes_is_still_detected_by_its_event(chain):
    """An attacker who edits a block and recomputes every hash after it still cannot match the event records."""
    _run(chain, ROLE_SWAP_SQL)
    conn = sqlite3.connect(chain)
    rows = conn.execute("SELECT block_index, timestamp, event_payload, previous_hash FROM ledger_blocks ORDER BY block_index").fetchall()
    previous = None
    for index, timestamp, payload, previous_hash in rows:
        if previous is not None:
            previous_hash = previous
        new_hash = compute_block_hash(index, timestamp, payload, previous_hash)
        conn.execute("UPDATE ledger_blocks SET previous_hash = ?, block_hash = ? WHERE block_index = ?", (previous_hash, new_hash, index))
        previous = new_hash
    conn.commit()
    conn.close()

    result = _verify(chain)

    assert result["result"] == "invalid"
    assert _failing_checks(result) == {"event_consistency"}
