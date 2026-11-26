"""Schema upgrades for databases created by earlier stories.

schema.sql uses CREATE TABLE IF NOT EXISTS, so it cannot change a table that already
exists. SQLite also cannot drop a NOT NULL constraint in place. When product_batches still
has the BPT-002 definition, it is rebuilt in two steps around the schema script:

1. retire_outdated_product_batches(): before schema.sql runs, rename the old table to
   product_batches_legacy with foreign keys off, so supply_chain_events keeps referring to
   the name "product_batches" and does not follow the renamed table.
2. complete_product_batches_upgrade(): after schema.sql has created the new table, copy
   every row (ids unchanged), check foreign keys, then drop the legacy table.

Both steps are idempotent, and an interrupted upgrade finishes on the next run. Other tables
and their rows are never touched.
"""

import sqlite3

LEGACY_PRODUCT_BATCHES = "product_batches_legacy"
PRODUCT_BATCHES_INDEXES = ("idx_product_batches_created_by", "idx_product_batches_status")
_COPIED_COLUMNS = (
    "id",
    "batch_code",
    "product_name",
    "description",
    "quantity",
    "unit",
    "origin",
    "harvest_date",
    "current_status",
    "created_by",
    "created_at",
)


class MigrationError(RuntimeError):
    """Raised when an upgrade cannot be completed safely; the database is left unchanged."""


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def _product_batches_is_current(conn: sqlite3.Connection) -> bool:
    # PRAGMA table_info rows: (cid, name, type, notnull, dflt_value, pk). Read by position so this
    # works whatever row_factory the connection uses.
    columns = {row[1]: row for row in conn.execute("PRAGMA table_info(product_batches)")}
    return "client_request_id" in columns and columns["batch_code"][3] == 0


def retire_outdated_product_batches(conn: sqlite3.Connection) -> None:
    """Step 1: move an outdated product_batches table aside so schema.sql can create the new one."""
    if not _table_exists(conn, "product_batches") or _product_batches_is_current(conn):
        return
    if _table_exists(conn, LEGACY_PRODUCT_BATCHES):
        raise MigrationError("A previous product_batches upgrade is incomplete; inspect the database.")

    # SQLite rewrites child foreign keys on RENAME unless foreign_keys is OFF and
    # legacy_alter_table is ON. The pragma is a no-op inside a transaction, so commit first.
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA legacy_alter_table = ON")
    try:
        for index in PRODUCT_BATCHES_INDEXES:
            conn.execute(f"DROP INDEX IF EXISTS {index}")
        conn.execute(f"ALTER TABLE product_batches RENAME TO {LEGACY_PRODUCT_BATCHES}")
        conn.commit()
    finally:
        conn.execute("PRAGMA legacy_alter_table = OFF")
        conn.execute("PRAGMA foreign_keys = ON")


def complete_product_batches_upgrade(conn: sqlite3.Connection) -> None:
    """Step 2: copy rows from the legacy table into the new product_batches and drop the legacy table."""
    if not _table_exists(conn, LEGACY_PRODUCT_BATCHES):
        return
    if not _table_exists(conn, "product_batches"):
        raise MigrationError("product_batches is missing; schema.sql must run before this step.")

    columns = ", ".join(_COPIED_COLUMNS)
    conn.execute(
        f"INSERT INTO product_batches ({columns}) SELECT {columns} FROM {LEGACY_PRODUCT_BATCHES}"
    )
    violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        conn.rollback()
        raise MigrationError("Foreign key check failed during product_batches upgrade; no changes kept.")

    conn.execute(f"DROP TABLE {LEGACY_PRODUCT_BATCHES}")
    conn.commit()
