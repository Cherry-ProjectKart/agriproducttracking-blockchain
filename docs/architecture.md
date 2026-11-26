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
  └─ created_by                           ledger_blocks (chain of blocks, no writer yet)
```

| Table | Key constraints |
|---|---|
| `users` | PK `id`; `username` UNIQUE; `role` ∈ {farmer, distributor, retailer} |
| `product_batches` | PK `id`; `batch_code` UNIQUE, nullable until US-03; `client_request_id` UNIQUE (idempotency key, nullable); `quantity` > 0; FK `created_by` → `users.id` (RESTRICT) |
| `supply_chain_events` | PK `id`; FK `batch_id` → `product_batches.id` (CASCADE); `actor_role` constrained to the three roles |
| `ledger_blocks` | PK `id`; `block_index` UNIQUE ≥ 0; `block_hash` UNIQUE |

Indexes: `users(role)`, `product_batches(created_by)`, `product_batches(current_status)`, `supply_chain_events(batch_id, event_timestamp)`.

Foreign keys are enforced per connection with `PRAGMA foreign_keys = ON`, since SQLite does not enforce them by default.

`product_batches.current_status` has a default of `CREATED` but is not yet constrained to a value list, because the status lifecycle belongs to a later user story. Registration sets it to `Registered`.

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

## 5a. Demo role access (US-01)

- **Sample accounts:** `init_db` seeds three rows into the existing `users` table (`demo.farmer`, `demo.distributor`, `demo.retailer`). No schema change or new table is involved, and seeding is idempotent.
- **Role constants:** `app/models/roles.py` defines the supported roles, labels, sample accounts and role-specific actions. `app/services/access_service.py` validates roles and looks up sample accounts.
- **Session:** `POST /api/session` stores `{role, user_id, display_name}` in Flask's signed session cookie (HTTP-only, `SameSite=Lax`). `DELETE /api/session` clears it.
- **Enforcement:** `app/auth.py` reads the role from the signed cookie on every request. The `require_role(...)` decorator returns `401` without a session and `403` for a disallowed role. The frontend never sends a role to a protected endpoint; it only receives what the server returns.
- **Frontend:** `useDemoSession` (in `src/hooks/`) mirrors the server session. `App` shows the role-selection screen (`DashboardPage`) when no role is active, or the role workspace (`RoleWorkspacePage`) with the active-role badge and **Exit session** otherwise.

Limitations are listed in the README under "Demo role access". This is a demonstration switch, not authentication.

## 5b. Product batch registration (US-02)

- **Write path:** `POST /api/batches` (`routes/batches.py`) is guarded by `require_role("farmer")`. It reads the farmer from the signed session and re-checks that the user is a farmer in the database. `services/batch_service.py` validates the fields (rules in `models/batch.py`) and writes the batch and its `PRODUCT_REGISTERED` event in one transaction.
- **Idempotency:** each write carries an `Idempotency-Key`, stored in `client_request_id`. A repeated request returns the existing batch (`200`). A key reused for different details returns `409`. A race between two identical requests is resolved by the unique constraint.
- **Read path:** `GET /api/batches` and `GET /api/batches/<id>` are limited to the farmer's own batches.
- **Frontend:** `FarmerBatchPanel` appears in the workspace only for the farmer role. It holds `BatchRegistrationForm` (client-side validation mirroring the server rules), `BatchDetails` (confirmation) and `BatchList`. Each new entry gets a new submission key, and a retry of the same entry reuses it.

## 6. Planned extensions (not in this foundation)

- **Blockchain:** a Python local blockchain will append to `ledger_blocks` using SHA-256 hashes linking each block to `previous_hash`.
- **QR codes:** the Python `qrcode` library will generate codes that reference a batch.
- **Feature APIs:** new blueprints under `app/routes/` with matching services; the frontend adds pages and service modules alongside the existing ones.

## 7. Known limitations

- Single-user local setup. Demo role access is a role selector without passwords or authentication (see section 5a).
- SQLite single-writer model; suitable for the prototype only.
- No migrations tool yet. Schema changes will be introduced with the feature stories that need them.
