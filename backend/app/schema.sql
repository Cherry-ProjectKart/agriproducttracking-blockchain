-- SQLite schema for the Blockchain Product Tracking foundation.
-- Idempotent: safe to run repeatedly (IF NOT EXISTS everywhere).
-- Foreign key enforcement is enabled per connection in app/db.py (PRAGMA foreign_keys = ON).

CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT    NOT NULL CHECK (length(trim(display_name)) > 0),
    username     TEXT    NOT NULL UNIQUE CHECK (length(trim(username)) > 0),
    role         TEXT    NOT NULL CHECK (role IN ('farmer', 'distributor', 'retailer')),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- batch_code stays NULL until the unique batch identifier story (US-03) assigns it.
-- client_request_id holds the client's Idempotency-Key so a repeated submission cannot
-- create a second batch. Databases created before BPT-003 are upgraded by app/migrations.py.
CREATE TABLE IF NOT EXISTS product_batches (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code        TEXT    UNIQUE CHECK (batch_code IS NULL OR length(trim(batch_code)) > 0),
    client_request_id TEXT    UNIQUE CHECK (client_request_id IS NULL OR length(trim(client_request_id)) > 0),
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

CREATE INDEX IF NOT EXISTS idx_product_batches_created_by ON product_batches (created_by);
CREATE INDEX IF NOT EXISTS idx_product_batches_status ON product_batches (current_status);

-- Every batch must have its unique batch ID (batch_code, US-03). The column is nullable in the
-- table definition only so that app/migrations.py can rebuild older tables; these triggers keep
-- the rule enforced. The UNIQUE constraint on batch_code enforces uniqueness.
CREATE TRIGGER IF NOT EXISTS product_batches_id_required_on_insert
BEFORE INSERT ON product_batches
WHEN NEW.batch_code IS NULL
BEGIN
    SELECT RAISE(ABORT, 'batch_code (batch ID) is required');
END;

CREATE TRIGGER IF NOT EXISTS product_batches_id_required_on_update
BEFORE UPDATE OF batch_code ON product_batches
WHEN NEW.batch_code IS NULL
BEGIN
    SELECT RAISE(ABORT, 'batch_code (batch ID) cannot be cleared');
END;

CREATE TABLE IF NOT EXISTS supply_chain_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id        INTEGER NOT NULL REFERENCES product_batches (id) ON DELETE CASCADE,
    event_type      TEXT    NOT NULL CHECK (length(trim(event_type)) > 0),
    actor_role      TEXT    NOT NULL CHECK (actor_role IN ('farmer', 'distributor', 'retailer')),
    status          TEXT    NOT NULL CHECK (length(trim(status)) > 0),
    note            TEXT,
    event_timestamp TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_supply_chain_events_batch_time
    ON supply_chain_events (batch_id, event_timestamp);

CREATE TABLE IF NOT EXISTS ledger_blocks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    block_index   INTEGER NOT NULL UNIQUE CHECK (block_index >= 0),
    timestamp     TEXT    NOT NULL,
    event_payload TEXT    NOT NULL,
    previous_hash TEXT    NOT NULL,
    block_hash    TEXT    NOT NULL UNIQUE CHECK (length(block_hash) > 0)
);
