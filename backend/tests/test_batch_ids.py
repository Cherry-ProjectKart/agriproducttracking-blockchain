"""Unique batch IDs (US-03): generation, database enforcement, registration and backfill."""

import re
import sqlite3

import pytest

from app.db import init_db
from app.services import batch_service
from app.services.batch_identifiers import (
    BATCH_ID_PATTERN,
    BatchIdAllocationError,
    generate_batch_id,
    is_valid_batch_id,
)
from app.services.batch_service import register_batch, validate_batch_input

VALID = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}


def _connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _farmer_id(conn):
    return conn.execute("SELECT id FROM users WHERE username = 'demo.farmer'").fetchone()[0]


def _register(conn, key, **changes):
    farmer_id = _farmer_id(conn)
    clean = validate_batch_input(dict(VALID, **changes))
    return register_batch(conn, farmer_id, key, clean)


# --- Format and generation ----------------------------------------------------


def test_generated_id_has_the_documented_format():
    for _ in range(200):
        code = generate_batch_id()
        assert re.fullmatch(r"PB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}", code)
        assert is_valid_batch_id(code)


def test_generated_id_never_uses_ambiguous_characters():
    for _ in range(500):
        code = generate_batch_id().replace("PB-", "").replace("-", "")
        assert not set(code) & set("ILOU")


def test_generated_ids_are_distinct_across_many_draws():
    codes = {generate_batch_id() for _ in range(5000)}

    assert len(codes) == 5000


@pytest.mark.parametrize(
    "value",
    ["", "PB-7K2M9QXD", "pb-7k2m-9qxd", "PB-7K2M-9QXI", "BATCH-1234", "PB-7K2M-9QX", None, 42],
)
def test_invalid_identifiers_are_rejected(value):
    assert not is_valid_batch_id(value)


# --- Registration --------------------------------------------------------------


def test_two_registered_batches_receive_different_ids(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    first, _ = _register(conn, "aaaaaaaa-1111-4111-8111-000000000001")
    second, _ = _register(conn, "aaaaaaaa-1111-4111-8111-000000000002", product_name="Wheat")
    conn.close()

    assert first["batch_id"] != second["batch_id"]
    assert BATCH_ID_PATTERN.match(first["batch_id"])
    assert BATCH_ID_PATTERN.match(second["batch_id"])


def test_replayed_submission_keeps_the_same_batch_id(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    first, created_first = _register(conn, "bbbbbbbb-2222-4222-8222-000000000001")
    again, created_again = _register(conn, "bbbbbbbb-2222-4222-8222-000000000001")
    conn.close()

    assert created_first is True and created_again is False
    assert again["batch_id"] == first["batch_id"]


def test_collision_with_an_existing_id_is_retried_with_a_new_id(db_path, monkeypatch):
    init_db(db_path)
    conn = _connect(db_path)
    existing, _ = _register(conn, "cccccccc-3333-4333-8333-000000000001")
    taken = existing["batch_id"]

    # The first candidate collides with the existing batch; the second is free.
    candidates = iter([taken, "PB-ZZZZ-0001"])
    monkeypatch.setattr(batch_service, "generate_batch_id", lambda: next(candidates))

    second, created = _register(conn, "cccccccc-3333-4333-8333-000000000002", product_name="Maize")
    conn.close()

    assert created is True
    assert second["batch_id"] == "PB-ZZZZ-0001"


def test_repeated_collisions_fail_clearly(db_path, monkeypatch):
    init_db(db_path)
    conn = _connect(db_path)
    existing, _ = _register(conn, "dddddddd-4444-4444-8444-000000000001")
    monkeypatch.setattr(batch_service, "generate_batch_id", lambda: existing["batch_id"])

    with pytest.raises(BatchIdAllocationError):
        _register(conn, "dddddddd-4444-4444-8444-000000000002", product_name="Maize")
    conn.close()

    # Nothing was written for the failed attempt.
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT COUNT(*) FROM product_batches").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM supply_chain_events").fetchone()[0] == 1
    conn.close()


# --- Database enforcement ---------------------------------------------------------


def test_database_rejects_a_duplicate_batch_id(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    farmer_id = _farmer_id(conn)
    insert = (
        "INSERT INTO product_batches (batch_code, product_name, quantity, unit, origin, harvest_date, created_by) "
        "VALUES (?, 'Rice', 1, 'kg', 'Farm', '2026-01-01', ?)"
    )
    conn.execute(insert, ("PB-DUPE-0001", farmer_id))

    with pytest.raises(sqlite3.IntegrityError, match="batch_code"):
        conn.execute(insert, ("PB-DUPE-0001", farmer_id))
    conn.close()


def test_database_rejects_a_batch_without_an_id(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    farmer_id = _farmer_id(conn)

    with pytest.raises(sqlite3.IntegrityError, match="batch ID"):
        conn.execute(
            "INSERT INTO product_batches (product_name, quantity, unit, origin, harvest_date, created_by) "
            "VALUES ('Rice', 1, 'kg', 'Farm', '2026-01-01', ?)",
            (farmer_id,),
        )
    conn.close()


def test_database_rejects_clearing_an_existing_id(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    batch, _ = _register(conn, "eeeeeeee-5555-4555-8555-000000000001")

    with pytest.raises(sqlite3.IntegrityError, match="cannot be cleared"):
        conn.execute("UPDATE product_batches SET batch_code = NULL WHERE id = ?", (batch["id"],))
    conn.close()


# --- Backfill for existing batches -------------------------------------------------


def _make_bpt003_state(db_path):
    """A database as left by BPT-003: batches without an ID, with events and users alongside."""
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    # BPT-003 had no trigger requiring the ID, so recreate that state.
    conn.execute("DROP TRIGGER product_batches_id_required_on_insert")
    conn.execute("DROP TRIGGER product_batches_id_required_on_update")
    conn.execute(
        "INSERT INTO users (id, display_name, username, role) VALUES (40, 'Existing Farmer', 'farmer.existing', 'farmer')"
    )
    farmer_id = conn.execute("SELECT id FROM users WHERE username = 'demo.farmer'").fetchone()[0]
    for index, product in enumerate(["Rice", "Wheat", "Maize"], start=1):
        conn.execute(
            "INSERT INTO product_batches (id, product_name, quantity, unit, origin, harvest_date, created_by) "
            "VALUES (?, ?, 10, 'kg', 'Farm', '2026-02-01', ?)",
            (index, product, farmer_id),
        )
        conn.execute(
            "INSERT INTO supply_chain_events (batch_id, event_type, actor_role, status, note) "
            "VALUES (?, 'PRODUCT_REGISTERED', 'farmer', 'Registered', 'before US-03')",
            (index,),
        )
    # One batch that already has a valid ID must keep it.
    conn.execute(
        "INSERT INTO product_batches (id, batch_code, product_name, quantity, unit, origin, harvest_date, created_by) "
        "VALUES (4, 'PB-KEEP-0001', 'Beans', 5, 'kg', 'Farm', '2026-02-02', ?)",
        (farmer_id,),
    )
    conn.commit()
    conn.close()


def test_existing_batches_receive_unique_ids_on_upgrade(db_path):
    _make_bpt003_state(db_path)

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    codes = [row[0] for row in conn.execute("SELECT batch_code FROM product_batches ORDER BY id")]
    conn.close()
    assert all(code is not None for code in codes)
    assert len(set(codes)) == len(codes)
    assert all(BATCH_ID_PATTERN.match(code) for code in codes if code != "PB-KEEP-0001")


def test_existing_id_is_not_changed_by_backfill(db_path):
    _make_bpt003_state(db_path)

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    kept = conn.execute("SELECT batch_code FROM product_batches WHERE id = 4").fetchone()[0]
    conn.close()
    assert kept == "PB-KEEP-0001"


def test_backfill_preserves_events_users_and_relationships(db_path):
    _make_bpt003_state(db_path)

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    events = conn.execute(
        "SELECT batch_id, note FROM supply_chain_events ORDER BY batch_id"
    ).fetchall()
    usernames = {row[0] for row in conn.execute("SELECT username FROM users")}
    fk_problems = conn.execute("PRAGMA foreign_key_check").fetchall()
    conn.close()
    assert events == [(1, "before US-03"), (2, "before US-03"), (3, "before US-03")]
    assert {"farmer.existing", "demo.farmer", "demo.distributor", "demo.retailer"} <= usernames
    assert fk_problems == []


def test_backfill_is_repeatable_and_does_not_reassign(db_path):
    _make_bpt003_state(db_path)
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    first = conn.execute("SELECT id, batch_code FROM product_batches ORDER BY id").fetchall()
    conn.close()

    init_db(db_path)
    init_db(db_path)

    conn = sqlite3.connect(db_path)
    second = conn.execute("SELECT id, batch_code FROM product_batches ORDER BY id").fetchall()
    conn.close()
    assert second == first


def test_backfill_assigns_each_pending_batch_a_different_id(db_path):
    _make_bpt003_state(db_path)

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    codes = [row[0] for row in conn.execute("SELECT batch_code FROM product_batches WHERE id IN (1, 2, 3)")]
    conn.close()
    assert len(set(codes)) == 3

