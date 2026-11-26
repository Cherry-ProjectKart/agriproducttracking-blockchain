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
| `product_batches` | PK `id`; `batch_code` UNIQUE; `quantity` > 0; FK `created_by` → `users.id` (RESTRICT) |
| `supply_chain_events` | PK `id`; FK `batch_id` → `product_batches.id` (CASCADE); `actor_role` constrained to the three roles |
| `ledger_blocks` | PK `id`; `block_index` UNIQUE ≥ 0; `block_hash` UNIQUE |

Indexes: `users(role)`, `product_batches(created_by)`, `product_batches(current_status)`, `supply_chain_events(batch_id, event_timestamp)`.

Foreign keys are enforced per connection with `PRAGMA foreign_keys = ON`, since SQLite does not enforce them by default.

`product_batches.current_status` has a default of `CREATED` but is not yet constrained to a value list, because the status lifecycle belongs to a later user story.

## 5. Configuration and environments

| Setting | Source | Notes |
|---|---|---|
| Backend settings | Environment variables, optionally `backend/.env` | `.env` is git-ignored; `.env.example` documents the keys. |
| Frontend API target | `VITE_API_PROXY_TARGET` in `frontend/.env.local` | Defaults to `http://127.0.0.1:5000`. |
| CORS | `CORS_ORIGINS` | Defaults to the Vite dev origins. Only `/api/*` is opened. |

## 6. Planned extensions (not in this foundation)

- **Blockchain:** a Python local blockchain will append to `ledger_blocks` using SHA-256 hashes linking each block to `previous_hash`.
- **QR codes:** the Python `qrcode` library will generate codes that reference a batch.
- **Feature APIs:** new blueprints under `app/routes/` with matching services; the frontend adds pages and service modules alongside the existing ones.

## 7. Known limitations

- Single-user local setup; no authentication or authorisation.
- SQLite single-writer model; suitable for the prototype only.
- No migrations tool yet. Schema changes will be introduced with the feature stories that need them.
