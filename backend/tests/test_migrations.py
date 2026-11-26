"""Upgrading a database created by BPT-002 (before product batches could be registered)."""

import sqlite3

import pytest

from app.db import init_db
from app.migrations import LEGACY_PRODUCT_BATCHES, retire_outdated_product_batches

# product_batches exactly as defined by BPT-002 (batch_code NOT NULL, no client_request_id).
BPT002_PRODUCT_BATCHES_DDL = """
CREATE TABLE product_batches (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code     TEXT    NOT NULL UNIQUE CHECK (length(trim(batch_code)) > 0),
    product_name   TEXT    NOT NULL CHECK (length(trim(product_name)) > 0),
    description    TEXT,
    quantity       REAL    NOT NULL CHECK (quantity > 0),
    unit           TEXT    NOT NULL CHECK (length(trim(unit)) > 0),
    origin         TEXT    NOT NULL CHECK (length(trim(origin)) > 0),
    harvest_date   TEXT    NOT NULL,
    current_status TEXT    NOT NULL DEFAULT 'CREATED',
    created_by     INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_product_batches_created_by ON product_batches (created_by);
CREATE INDEX idx_product_batches_status ON product_batches (current_status);
"""


def _make_bpt002_database(db_path):
    """Build a database in the BPT-002 state: current tables, old product_batches, real data."""
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("DROP TABLE product_batches")  # also drops its indexes
    conn.executescript(BPT002_PRODUCT_BATCHES_DDL)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        "INSERT INTO users (id, display_name, username, role) VALUES (40, 'Existing Farmer', 'farmer.existing', 'farmer')"
    )
    conn.execute(
        """
        INSERT INTO product_batches
            (id, batch_code, product_name, description, quantity, unit, origin, harvest_date,
             current_status, created_by, created_at)
        VALUES (7, 'LEGACY-7', 'Tomatoes', 'Vine ripened', 12.5, 'kg', 'North Field', '2026-09-01',
                'CREATED', 40, '2026-09-02T10:00:00.000Z')
        """
    )
    conn.execute(
        """
        INSERT INTO supply_chain_events (batch_id, event_type, actor_role, status, note)
        VALUES (7, 'PRODUCT_REGISTERED', 'farmer', 'Registered', 'legacy event')
        """
    )
    conn.commit()
    conn.close()


def _columns(db_path, table):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    conn.close()
    return {row[1]: row for row in rows}


def _table_names(db_path):
    conn = sqlite3.connect(db_path)
    names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    conn.close()
    return names


def test_bpt002_database_is_upgraded_in_place(db_path):
    _make_bpt002_database(db_path)
    assert "client_request_id" not in _columns(db_path, "product_batches")

    init_db(db_path)

    columns = _columns(db_path, "product_batches")
    assert "client_request_id" in columns
    assert columns["batch_code"][3] == 0  # notnull is now 0: batch_code is optional
    assert LEGACY_PRODUCT_BATCHES not in _table_names(db_path)


def test_existing_batch_and_event_are_preserved_with_same_ids(db_path):
    _make_bpt002_database(db_path)

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    batch = conn.execute("SELECT * FROM product_batches WHERE id = 7").fetchone()
    event = conn.execute("SELECT * FROM supply_chain_events WHERE batch_id = 7").fetchone()
    conn.close()
    assert batch["batch_code"] == "LEGACY-7"
    assert batch["product_name"] == "Tomatoes"
    assert batch["quantity"] == 12.5
    assert batch["created_by"] == 40
    assert batch["created_at"] == "2026-09-02T10:00:00.000Z"
    assert batch["client_request_id"] is None
    assert event["note"] == "legacy event"


def test_users_and_demo_accounts_are_preserved(db_path):
    _make_bpt002_database(db_path)

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    usernames = {row[0] for row in conn.execute("SELECT username FROM users")}
    conn.close()
    assert "farmer.existing" in usernames
    assert {"demo.farmer", "demo.distributor", "demo.retailer"} <= usernames


def test_foreign_keys_are_intact_after_upgrade(db_path):
    _make_bpt002_database(db_path)

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    # The event's foreign key must still point at product_batches, not a leftover legacy table.
    fk_targets = [row[2] for row in conn.execute("PRAGMA foreign_key_list(supply_chain_events)")]
    conn.close()
    assert fk_targets == ["product_batches"]


def test_indexes_are_recreated_on_new_table(db_path):
    _make_bpt002_database(db_path)

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    indexes = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'product_batches'")}
    conn.close()
    assert {"idx_product_batches_created_by", "idx_product_batches_status"} <= indexes


def test_upgrade_is_repeatable(db_path):
    _make_bpt002_database(db_path)
    init_db(db_path)

    init_db(db_path)
    init_db(db_path)

    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM product_batches").fetchone()[0]
    conn.close()
    assert count == 1


def test_interrupted_upgrade_is_completed_on_next_run(db_path):
    _make_bpt002_database(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    retire_outdated_product_batches(conn)  # simulate a stop after step one
    conn.close()
    assert LEGACY_PRODUCT_BATCHES in _table_names(db_path)

    init_db(db_path)

    assert LEGACY_PRODUCT_BATCHES not in _table_names(db_path)
    assert _columns(db_path, "product_batches")["batch_code"][3] == 0
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT batch_code FROM product_batches WHERE id = 7").fetchone()[0] == "LEGACY-7"
    conn.close()


def test_upgraded_table_rejects_batches_without_batch_id(db_path):
    # BPT-003 made batch_code nullable so the rebuild could run. US-03 requires every batch to
    # have an ID, so after the upgrade a batch without one is refused by a trigger.
    _make_bpt002_database(db_path)
    init_db(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    with pytest.raises(sqlite3.IntegrityError, match="batch ID"):
        conn.execute(
            """
            INSERT INTO product_batches
                (client_request_id, product_name, quantity, unit, origin, harvest_date, current_status, created_by)
            VALUES ('upgrade-check-key', 'Maize', 3, 'bags', 'East Plot', '2026-11-01', 'Registered', 40)
            """
        )
    conn.close()


def test_fresh_database_has_the_new_product_batches_definition(db_path):
    init_db(db_path)

    columns = _columns(db_path, "product_batches")
    assert "client_request_id" in columns
    assert columns["batch_code"][3] == 0
