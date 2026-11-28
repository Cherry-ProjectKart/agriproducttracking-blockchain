# Architecture: local system

This document describes the foundation architecture for the Blockchain Product Tracking prototype. It runs entirely on a developer machine: no Docker, no cloud, no external blockchain network.

## 1. Components

```text
┌──────────────────────────┐        HTTP /api/*        ┌──────────────────────────┐
│ Browser                  │ ───────────────────────▶ │ Vite dev server :5173    │
│ React SPA (frontend/)    │ ◀─────────────────────── │  - serves React app      │
└──────────────────────────┘                           │  - proxies /api → Flask  │
                                                       └────────────┬─────────────┘
                                                                    │ HTTP /api/*
                                                                    ▼
                                                       ┌──────────────────────────┐
                                                       │ Flask API :5000          │
                                                       │ backend/app              │
                                                       │  routes → services → db  │
                                                       └────────────┬─────────────┘
                                                                    │ sqlite3
                                                                    ▼
                                                       ┌──────────────────────────┐
                                                       │ SQLite file              │
                                                       │ backend/instance/*.db    │
                                                       └──────────────────────────┘
```

| Component | Responsibility |
|---|---|
| React SPA | Presentation only. Calls the REST API through `src/services/`. |
| Vite dev server | Serves the SPA in development and proxies `/api/*` to Flask, avoiding CORS in normal use. |
| Flask API | Exposes REST endpoints. Validates requests, delegates to services, returns JSON. |
| SQLite | Persistent store for users, batches, supply-chain events and ledger blocks. |

## 2. Backend layering

| Layer | Location | Rule |
|---|---|---|
| Routes | `app/routes/` | HTTP only: parse the request, call a service, shape the response. |
| Services | `app/services/` | Business logic and orchestration. No Flask request objects. |
| Database | `app/db.py`, `app/schema.sql` | Connection management, initialisation and schema. |
| Models | `app/models/` | Domain models, populated in feature stories. |
| Config | `app/config.py` | Reads environment variables (optionally from `backend/.env`). |
| Errors | `app/errors.py` | Converts exceptions into consistent JSON error bodies. |

The application is created by a factory (`create_app`) so tests can supply their own configuration and temporary database.

## 3. Request flow (health check)

1. Browser loads the dashboard from Vite and calls `GET /api/health`.
2. Vite forwards the request to Flask on `127.0.0.1:5000`.
3. `routes/health.py` calls `services/health_service.get_health_status()`.
4. The service calls `db.check_database()`, which opens the SQLite file read-only in intent (it never creates the file) and checks that the four expected tables exist.
5. The route returns `200` when healthy and `503` with a degraded payload otherwise. The frontend renders both states.

## 4. Data model

```text
users 1 ──── * product_batches 1 ──── * supply_chain_events
  │
  └─ created_by                           ledger_blocks (hash-linked chain, written at registration)
```

| Table | Key constraints |
|---|---|
| `users` | PK `id`; `username` UNIQUE (stored lower-case); `role` ∈ {farmer, distributor, retailer}; `password_hash` (nullable, salted scrypt); `status` ∈ {active, disabled}; `display_name` holds the full name; `updated_at` |
| `product_batches` | PK `id`; `batch_code` UNIQUE batch ID (`PB-XXXX-XXXX`, required by trigger); `client_request_id` UNIQUE (idempotency key, nullable); `quantity` > 0; FK `created_by` → `users.id` (RESTRICT) |
| `supply_chain_events` | PK `id`; FK `batch_id` → `product_batches.id` (CASCADE); `actor_role` constrained to the three roles |
| `ledger_blocks` | PK `id`; `block_index` UNIQUE ≥ 0; `block_hash` UNIQUE; `event_id` → `supply_chain_events.id`, UNIQUE (one block per event; BPT-005) |

Indexes: `users(role)`, `product_batches(created_by)`, `product_batches(current_status)`, `supply_chain_events(batch_id, event_timestamp)`.

Foreign keys are enforced per connection with `PRAGMA foreign_keys = ON`, since SQLite does not enforce them by default.

`product_batches.current_status` has a default of `CREATED` and no database CHECK constraint. The status lifecycle is enforced in code instead: `app/models/shipment.py` defines the shipment transitions and `app/models/receipt.py` defines the receipt rule, and both are checked inside the transaction that writes the change. Registration sets it to `Registered`.

### Schema upgrades (BPT-003)

`schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so it cannot change an existing table. `app/migrations.py` handles the BPT-002 `product_batches` definition:

1. Before `schema.sql` runs, the old table is renamed to `product_batches_legacy`, with foreign keys off so that `supply_chain_events` keeps pointing at `product_batches`.
2. `schema.sql` creates the new table. The rows are copied with their original ids, foreign keys are checked, and the legacy table is dropped.

Both steps are idempotent, and an interrupted upgrade completes on the next `init_db` run. No other table is changed.

## 5. Configuration and environments

| Setting | Source | Notes |
|---|---|---|
| Backend settings | Environment variables, optionally `backend/.env` | `.env` is git-ignored; `.env.example` documents the keys. |
| Frontend API target | `VITE_API_PROXY_TARGET` in `frontend/.env.local` | Defaults to `http://127.0.0.1:5000`. |
| CORS | `CORS_ORIGINS` | Defaults to the Vite dev origins. Only `/api/*` is opened. |

## 5a. Accounts and sign-in (BPT-101, extends US-01)

- **Accounts:** `users` gains `password_hash`, `status` and `updated_at` (added by `migrations.ensure_user_account_columns` on existing databases, no rows changed). Each account has one role. Usernames are stored lower-case, so the UNIQUE constraint is case-insensitive in practice.
- **Registration:** `POST /api/accounts` (`routes/accounts.py`) validates every field on the server (`services/account_service.validate_registration`, rules in `models/account.py`), stores a hash only, and signs the account in.
- **Sign-in:** `POST /api/session` (`routes/access.py`) takes `{username, password}`. `services/account_service.authenticate` verifies the hash with `check_password_hash`. The role is read from the database; a role in the request body is ignored.
- **Session:** the signed Flask cookie stores `{user_id, issued_at}` only. `app/auth.py:current_account` reads the account from the database on every request and rejects missing, disabled, unsupported-role or expired sessions. The lifetime is `SESSION_LIFETIME_HOURS`.
- **Enforcement:** `require_role` is unchanged in contract (401 without a valid sign-in, 403 for a disallowed role). Batch, shipment and receipt routes use `current_account` for the account id.
- **Demo accounts:** `services/access_service.seed_demo_users` creates `demo.farmer`, `demo.distributor` and `demo.retailer`. Their passwords come from `DEMO_*_PASSWORD`, are hashed, and are set only when no hash is stored. Restarting never overwrites a stored password.
- **Frontend:** `useAccountSession` mirrors `/api/session`. `App` shows `SignInPage` or `RegisterPage` (path check in `utils/routes.js`), or the role workspace when signed in. Sign out calls `DELETE /api/session`. The `/track/<batch ID>` route is unchanged and does not need a session.

## 5b. Product batch registration (US-02)

- **Write path:** `POST /api/batches` (`routes/batches.py`) is guarded by `require_role("farmer")`. It reads the farmer from the signed session and re-checks that the user is a farmer in the database. `services/batch_service.py` validates the fields (rules in `models/batch.py`) and writes the batch and its `PRODUCT_REGISTERED` event in one transaction.
- **Idempotency:** each write carries an `Idempotency-Key`, stored in `client_request_id`. A repeated request returns the existing batch (`200`). A key reused for different details returns `409`. A race between two identical requests is resolved by the unique constraint.
- **Read path:** `GET /api/batches` and `GET /api/batches/<id>` are limited to the farmer's own batches.
- **Frontend:** `FarmerBatchPanel` appears in the workspace only for the farmer role. It holds `BatchRegistrationForm` (client-side validation mirroring the server rules), `BatchDetails` (confirmation) and `BatchList`. Each new entry gets a new submission key, and a retry of the same entry reuses it.

## 5c. Batch IDs and QR codes (US-03)

- **Batch ID:** `PB-XXXX-XXXX` (Crockford base32, random via `secrets`), in `product_batches.batch_code`. Generated in `services/batch_identifiers.py` and stored in the same transaction as the batch. Uniqueness: `UNIQUE` on `batch_code`, with a retry on collision (up to 10 attempts).
- **Required ID:** BEFORE INSERT and BEFORE UPDATE triggers in `schema.sql` reject a NULL `batch_code`.
- **Backfill:** `migrations.backfill_batch_ids` runs in `init_db` after the schema step. It assigns an ID only to batches that have none, in one transaction, and it is safe to repeat.
- **Tracking URL:** `{TRACKING_BASE_URL}/track/{batch ID}`, built in `services/qr_service.py`. `TRACKING_BASE_URL` (default `http://localhost:5173`) is validated at startup.
- **QR code:** PNG, error-correction level M, generated on request by `segno` and served from `GET /api/batches/<id>/qr.png` to the owning farmer only. Nothing is stored. The image encodes only the tracking URL.
- **Frontend:** `BatchQrCode` shows the image, the tracking URL, a **Download QR code (PNG)** button and a **Copy tracking link** button, each with a result message. `BatchDetails` shows the batch ID. `BatchList` shows the ID, opens a batch's QR code and its history.
- **Scope:** the `/track/<batch ID>` page is the public consumer page of US-08 (section 5h).

## 5d. Local hash-linked ledger (US-04)

- **Storage:** `ledger_blocks` (`block_index`, `timestamp`, `event_payload` as canonical JSON, `previous_hash`, `block_hash`, and `event_id`). Only `event_id` is new, added by `ensure_ledger_event_reference` with a UNIQUE index.
- **Service:** `services/ledger_service.py` contains canonical JSON, hashing, genesis creation, `append_block`, lookups, chronological listing and the backfill. It does not import Flask.
- **Hash:** SHA-256 over the UTF-8 bytes of `{"event_data":<payload as JSON string>,"index":<n>,"previous_hash":"<hex>","timestamp":"<ISO>"}`, with sorted keys and compact separators. The block's own hash is not part of the input. Genesis is block 0, with timestamp `1970-01-01T00:00:00.000Z`, event data `{"event_type":"GENESIS"}` and 64 zero characters as the previous hash.
- **Registration:** `batch_service.register_batch` writes the batch, its event and the block in one transaction. `BEGIN IMMEDIATE` is used unless the caller already has a transaction open. Any failure rolls back everything.
- **Backfill:** `backfill_registration_ledger` adds a block to each `PRODUCT_REGISTERED` event that has none, in event-time order. Blocks use the event's time. The step is repeatable.
- **Read path:** `routes/ledger.py` exposes read-only endpoints to any active demo session. No endpoint writes to the ledger.
- **Frontend:** `LedgerView` (in every workspace) lists the blocks.
- **Scope:** verification of the chain (US-07) is not implemented. The hashes are shown so the chain can be checked by hand.

## 5e. Distributor shipment updates (US-05)

- **Statuses:** `models/shipment.py` lists `Shipped`, `In Transit` and `Delivered to Retailer`, the only values accepted. The same strings are used in the form (`utils/shipmentValidation.js`), the database, the event and the ledger payload.
- **Write path:** `POST /api/shipments` (`routes/shipments.py`) is guarded by `require_role("distributor")` and re-checks the distributor in the database. `services/shipment_service.py` validates the input and then, in one `BEGIN IMMEDIATE` transaction, updates `product_batches.current_status`, inserts a `SHIPMENT_UPDATED` event and appends the block through the existing `ledger_service.append_block`. Any failure rolls all three back.
- **Idempotency:** `supply_chain_events.client_request_id` holds the `Idempotency-Key`, with a UNIQUE index added by `migrations.ensure_event_request_key`. A repeat with the same details returns the stored result. Different details return `409`.
- **Read path:** `GET /api/shipments/batches` lists every registered batch for distributors. It does not include the farmer's identity.
- **Frontend:** `DistributorShipmentPanel`, rendered only for the distributor role. It has the batch selection table, the status selector, the note, and the saved confirmation with the block number and hash. The batch list refreshes after each save.
- **Scope:** shipments never set `Received by Retailer`. That status belongs to US-06 (section 5f).

## 5f. Retailer receipt confirmation (US-06)

- **Statuses:** `models/receipt.py` defines the eligible status (`Delivered to Retailer`), the received status (`Received by Retailer`) and the event type `RECEIPT_CONFIRMED`, with actor `retailer`.
- **Write path:** `POST /api/receipts` (`routes/receipts.py`) is guarded by `require_role("retailer")` and re-checks the retailer in the database. `services/receipt_service.py` runs one `BEGIN IMMEDIATE` transaction: the eligibility check, the status update, the event insert and `ledger_service.append_block`. Any failure rolls all of them back.
- **Eligibility:** only `Delivered to Retailer` can move to `Received by Retailer`. Other statuses, and an already received batch, return `409`.
- **Idempotency:** the event's `client_request_id` (from BPT-006) holds the `Idempotency-Key`. A repeat with the same key returns the stored receipt. A new key on a received batch is refused.
- **Read path:** `GET /api/receipts/awaiting` lists batches with status `Delivered to Retailer`, without farmer identity.
- **Schema:** no change. The existing columns and the request-key index carry the receipt.
- **Frontend:** `RetailerReceiptPanel`, rendered only for the retailer role, with batch selection, a confirmation step and the saved receipt.

## 5g. Batch history and ledger verification (US-07)

- **History:** `services/history_service.py` returns one batch's `PRODUCT_REGISTERED`, `SHIPMENT_UPDATED` and `RECEIPT_CONFIRMED` events, ordered by `event_timestamp` then `id`, with the block index from `ledger_blocks` (joined on `event_id`). Served by `GET /api/history/<batch ID>` (`routes/history.py`).
- **Verification:** `services/ledger_verification.py` reads every block and does not trust the stored hashes. It recalculates each block hash with `ledger_service.compute_block_hash`, the BPT-005 algorithm, and checks the previous-hash links against those recalculated values. It also checks genesis, sequence, canonical serialisation, timestamp and hash formats, event references and that each supported event has one block. Served by `GET /api/ledger/verify` (`routes/ledger.py`).
- **Read-only:** the verifier sets `PRAGMA query_only` while it runs and restores the previous setting afterwards. It never appends, repairs or deletes.
- **Result:** `result` is `valid` only when no check fails. Each failure names the block index (or none, for ledger-wide problems), the check and a reason.
- **Frontend:** `BatchHistoryPanel` and `LedgerVerificationPanel` appear in every workspace. Neither loads anything until the user acts, and Valid or Invalid is shown only after the server has answered.
- **Scope:** no schema change and no new role. The consumer tracking page (US-08) is not part of this story.

## 5h. Consumer QR tracking (US-08)

- **Public endpoint:** `GET /api/tracking/<batch ID>` (`routes/tracking.py`) has no role guard. `services/public_tracking.py` reuses the BPT-008 `batch_history` service and keeps only a whitelist of fields (batch ID, product name, origin, current status; for each event type, label, actor role, status, note, timestamp and ledger block index). Internal row IDs, users and request keys are not returned. The endpoint accepts only `GET`.
- **Frontend routing:** `Root.jsx` chooses the page from the address. `/track/<batch ID>` renders `ConsumerTrackingPage`, which is standalone and does not load the session, role or workspace code. Every other address renders the application as before. The router is a single path check (`utils/routes.js`), with no routing library.
- **Read-only page:** the page has no buttons, forms, inputs or links. A test checks this.
- **QR path:** unchanged from BPT-004. The QR encodes `{TRACKING_BASE_URL}/track/{batch ID}`, and the decoded URL is verified by a test against the real PNG.
- **Schema:** no change. The history service gained the origin in its batch summary, an additive change.
- **Network:** the frontend (Vite, port 5173) serves the page and proxies `/api`. Flask stays on 127.0.0.1. Scanning from another device needs `TRACKING_BASE_URL` set to the host's LAN address and the dev server started with `--host`.

## 6. Planned extensions (not in this foundation)

- **Feature APIs:** new blueprints under `app/routes/` with matching services; the frontend adds pages and service modules alongside the existing ones.

## 7. Known limitations

- Single-user local setup. Sign-in has no rate limit, CSRF token or password reset (see section 5a).
- SQLite single-writer model; suitable for the prototype only.
- No migrations tool yet. Schema changes will be introduced with the feature stories that need them.
