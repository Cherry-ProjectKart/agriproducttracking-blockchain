import sqlite3

import pytest

from app.db import EXPECTED_TABLES, init_db, list_tables


def _connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def test_init_db_creates_file_and_all_four_tables(db_path):
    tables = init_db(db_path)

    assert tables == sorted(EXPECTED_TABLES)
    assert list_tables(db_path) == sorted(EXPECTED_TABLES)


def test_init_db_is_idempotent(db_path):
    init_db(db_path)
    init_db(db_path)

    assert list_tables(db_path) == sorted(EXPECTED_TABLES)


def test_users_role_is_constrained(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO users (display_name, username, role) VALUES ('A', 'a', 'admin')"
            )
    finally:
        conn.close()


def test_usernames_are_unique(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    try:
        conn.execute("INSERT INTO users (display_name, username, role) VALUES ('A', 'alice', 'farmer')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO users (display_name, username, role) VALUES ('B', 'alice', 'retailer')")
    finally:
        conn.close()


def test_batch_requires_existing_creator(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO product_batches (batch_code, product_name, quantity, unit, origin, harvest_date, created_by) "
                "VALUES ('B-1', 'Rice', 10, 'kg', 'Farm A', '2026-01-01', 999)"
            )
    finally:
        conn.close()


def test_batch_quantity_must_be_positive(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    try:
        conn.execute("INSERT INTO users (display_name, username, role) VALUES ('A', 'alice', 'farmer')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO product_batches (batch_code, product_name, quantity, unit, origin, harvest_date, created_by) "
                "VALUES ('B-1', 'Rice', 0, 'kg', 'Farm A', '2026-01-01', 1)"
            )
    finally:
        conn.close()


def test_events_cascade_when_batch_deleted(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    try:
        conn.execute("INSERT INTO users (display_name, username, role) VALUES ('A', 'alice', 'farmer')")
        conn.execute(
            "INSERT INTO product_batches (batch_code, product_name, quantity, unit, origin, harvest_date, created_by) "
            "VALUES ('B-1', 'Rice', 10, 'kg', 'Farm A', '2026-01-01', 1)"
        )
        conn.execute(
            "INSERT INTO supply_chain_events (batch_id, event_type, actor_role, status) "
            "VALUES (1, 'HARVESTED', 'farmer', 'OK')"
        )
        conn.execute("DELETE FROM product_batches WHERE id = 1")
        remaining = conn.execute("SELECT COUNT(*) FROM supply_chain_events").fetchone()[0]
        assert remaining == 0
    finally:
        conn.close()


def test_ledger_block_hash_is_unique(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    try:
        conn.execute(
            "INSERT INTO ledger_blocks (block_index, timestamp, event_payload, previous_hash, block_hash) "
            "VALUES (0, '2026-01-01T00:00:00Z', '{}', '0', 'abc')"
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO ledger_blocks (block_index, timestamp, event_payload, previous_hash, block_hash) "
                "VALUES (1, '2026-01-01T00:00:01Z', '{}', 'abc', 'abc')"
            )
    finally:
        conn.close()
