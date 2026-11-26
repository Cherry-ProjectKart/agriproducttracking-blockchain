# Blockchain Product Tracking

A blockchain-enabled system for tracing agricultural products from farm to retail. Every supply-chain event is recorded in a tamper-evident ledger so that a product's journey can be verified by farmers, distributors, retailers and consumers.

> **Status:** unique batch IDs and QR codes (BPT-004, US-03) on top of farmer batch registration (BPT-003, US-02), demo role access (BPT-002, US-01) and the project foundation (BPT-001). The consumer tracking page, shipment updates, receipt confirmation and the ledger are not implemented yet.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Backend | Python Flask (application factory) |
| Database | SQLite |
| API | REST (JSON over HTTP) |
| Blockchain (future story) | Python local blockchain |
| Hashing (future story) | SHA-256 |
| QR codes (future story) | Python `qrcode` |

See [docs/architecture.md](docs/architecture.md) for the system design.

## Folder structure

```text
blockchain-product-tracking/
├── backend/
│   ├── app/
│   │   ├── routes/          # REST blueprints (health.py)
│   │   ├── services/        # business logic (health_service.py)
│   │   ├── models/          # domain models (populated in feature stories)
│   │   ├── config.py        # environment-based configuration
│   │   ├── db.py            # SQLite connection management and initialisation
│   │   ├── errors.py        # JSON error responses
│   │   ├── schema.sql       # database schema
│   │   └── __init__.py      # Flask application factory
│   ├── scripts/
│   │   └── init_db.py       # creates the database and tables
│   ├── tests/               # pytest suite
│   ├── .env.example
│   ├── pytest.ini
│   ├── requirements.txt
│   └── run.py               # development entry point
├── frontend/
│   ├── src/
│   │   ├── components/      # reusable UI components
│   │   ├── pages/           # routed pages (DashboardPage)
│   │   ├── services/        # API client layer
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   └── vite.config.js       # dev server + /api proxy to Flask
├── docs/
│   └── architecture.md
├── .gitignore
└── README.md
```

## Prerequisites

- Python 3.11+ (developed with 3.13)
- Node.js 20.19+ and npm 10+ (developed with Node 20.20)
- Git

## Backend setup

Run from the repository root in PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` if you need different values. The defaults work for local development.

## Database initialisation

From `backend/` with the virtual environment active:

```powershell
python scripts/init_db.py
```

This creates `backend/instance/product_tracking.db` (if missing) and the four tables `users`, `product_batches`, `supply_chain_events` and `ledger_blocks`. The script is idempotent and can be re-run safely.

## Frontend setup

```powershell
cd frontend
npm install
```

Optional: copy `frontend/.env.example` to `frontend/.env.local` if the backend does not run on `http://127.0.0.1:5000`.

## Running the application

Start the backend (terminal 1, from `backend/` with the venv active):

```powershell
python run.py
```

Start the frontend (terminal 2, from `frontend/`):

```powershell
npm run dev
```

Open <http://localhost:5173>. The landing screen lists the demonstration roles and shows backend and database status. The Vite dev server forwards `/api/*` requests to Flask, so the browser never calls port 5000 directly.

Health endpoint: `GET http://127.0.0.1:5000/api/health`

- `200` with `"status": "ok"` when the API is running and the database schema is present.
- `503` with `"status": "degraded"` when the database file or schema is missing (run `init_db.py`).

## Demo role access

This is the basic access for the academic demonstration (user story US-01). It is **not** production authentication.

### Supported demo roles

| Role | Sample account | What the role's workspace lists |
|---|---|---|
| Farmer | `demo.farmer` (Demo Farmer) | Register product batch |
| Distributor | `demo.distributor` (Demo Distributor) | Record shipment update |
| Retailer | `demo.retailer` (Demo Retailer) | Confirm receipt of batch |

The sample accounts are created in the existing `users` table by `python scripts/init_db.py`. They have no passwords. The listed actions are placeholders: they show as "Not available yet" until their stories are built.

### How it works

1. Open the app. If no session is active, choose Farmer, Distributor or Retailer.
2. The backend validates the role, starts a session, and stores the role in a signed, HTTP-only cookie.
3. The header shows the active role. The workspace shows that role's actions, fetched from `GET /api/role-actions`. The backend returns actions only for the role held by the session.
4. Select **Exit session** to end the session. The app returns to the role-selection screen.
5. Refreshing the page keeps the same role while the backend keeps running. Restarting the backend (with no `SECRET_KEY` set) ends all sessions.

### Demo access API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/roles` | none | Supported roles with labels and descriptions |
| GET | `/api/session` | none | Current session: `active`, `role`, `role_label`, `display_name` |
| POST | `/api/session` | none | Body `{"role": "farmer"}`. Starts a session. `201` on success, `400` for a missing or unsupported role, `503` if sample accounts are missing |
| DELETE | `/api/session` | none | Exits the session. Idempotent |
| GET | `/api/role-actions` | active session | Actions for the session's role. `401` with no session |

Endpoints that require a role use the `require_role(...)` decorator in `backend/app/auth.py`. It returns `401` with no session and `403` when the session's role is not allowed.

### Security limitations

- **No authentication.** Anyone who can reach the backend can select any role. There are no passwords, registration, email verification, password recovery or external identity provider.
- **Role selection is a demonstration switch,** not an identity. The role is trusted for display and for the demo's role checks only.
- **Localhost only.** The design assumes a single local user on a trusted machine. Do not expose the backend to a network.
- **Cookie-based session.** The role is stored in a cookie signed with `SECRET_KEY`. Without `SECRET_KEY`, a random key is generated at each backend start. Set `SECRET_KEY` in `backend/.env` for stable sessions across restarts. Do not use the value from `.env.example` for anything real.
- **Session cookies are not marked `Secure`** because localhost uses plain HTTP. Set `SESSION_COOKIE_SECURE=1` only when serving over HTTPS.
- **No CSRF token.** `SameSite=Lax` limits cross-site requests, but a same-site page could still switch roles. The impact is limited to this demo.
- **Sessions are browser-session cookies** with no idle timeout.

## Product batch registration (US-02)

A farmer registers an agricultural product batch from the Farmer workspace.

### Workflow

1. Choose **Farmer** on the role screen. The Farmer workspace shows the **Register a product batch** form and the list of your batches.
2. Enter the batch details. Fields marked * are required. Errors appear beside each field.
3. Select **Register batch**. The button shows *Registering…* until the server answers.
4. On success, a confirmation shows the batch details, the form clears, and the batch appears in **Your registered batches**.

### Fields

| Field | Required | Rules |
|---|---|---|
| Product name | yes | 1–120 characters |
| Origin or farm location | yes | 1–200 characters |
| Quantity | yes | Positive decimal number, for example `25` or `12.5`. Exponents, signs and zero are rejected |
| Unit | yes | 1–20 characters, free text (for example `kg` or `crates`) |
| Harvest or registration date | yes | Real calendar date in `YYYY-MM-DD` format |
| Description | no | Up to 500 characters |

The SRS requires product name, quantity, unit and origin (section 7.3). The harvest or registration date is also required here because the US-02 field list includes it and the database column is non-null. The length limits are demo defaults; the SRS does not set them.

Validation runs in the browser and again on the server. The server's rules are the ones that count.

### Role restrictions

- Only an active **Farmer** session can register or list batches. Distributor and Retailer sessions get `403`, and the form is not rendered for them.
- The farmer is taken from the signed session, never from the request body. Fields such as `created_by` or `current_status` sent in the body are ignored.
- A farmer sees only the batches they registered.

### Duplicate protection

Every registration request must include an `Idempotency-Key` header (8–64 letters, digits or hyphens). The web app generates a UUID for each entry. If the same submission is sent again, for example after a network error, the server returns the batch that was already saved (`200`) instead of creating a second one. Reusing the key for different details returns `409`.

### Registration API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/batches` | Farmer session + `Idempotency-Key` | Register a batch. `201` when created, `200` for a repeated submission, `400` for invalid input, `409` for a key reused with different details |
| GET | `/api/batches` | Farmer session | The farmer's batches, newest first |
| GET | `/api/batches/<id>` | Farmer session | One of the farmer's batches. `404` when it does not exist or belongs to another farmer |

Request body for `POST /api/batches`:

```json
{
  "product_name": "Basmati Rice",
  "description": "Long-grain rice harvested in October.",
  "quantity": 250,
  "unit": "kg",
  "origin": "Green Valley Farm, Plot 4",
  "harvest_date": "2026-10-15"
}
```

Response (`201`): `{"batch": {"id", "product_name", "description", "quantity", "unit", "origin", "harvest_date", "current_status", "created_at"}}`. `current_status` is `Registered`.

Validation errors return `400` with per-field messages in `error.details`, for example `{"error": {"code": 400, "message": "Please correct the highlighted fields.", "details": {"quantity": "Quantity must be greater than zero."}}}`.

### Database changes

The `product_batches` table was changed in two ways. Existing databases are upgraded automatically by `python scripts/init_db.py`, and existing users, sessions and other rows are kept.

- `batch_code` is now **nullable** in the table definition, so the rebuild could run. It holds the unique batch ID from US-03, and triggers (BPT-004) reject any batch without one.
- `client_request_id` (unique, nullable) was added to store the `Idempotency-Key`.

A registration also writes one `supply_chain_events` row: `event_type` `PRODUCT_REGISTERED`, `actor_role` `farmer`, `status` `Registered`. No ledger block is created; that is US-04.

SQLite cannot drop a `NOT NULL` constraint in place, so the upgrade rebuilds `product_batches` (see `backend/app/migrations.py`). It runs with foreign keys off, copies every row with its original id, checks foreign keys, and only then drops the old table. The upgrade can be run again safely.

### Limitations

- The farmer's list is the only batch view. Distributor and Retailer lists belong to later stories.
- The role check follows the BPT-002 demo model. It is not authentication (see Demo role access).

## Batch IDs and QR codes (US-03)

Each registered batch gets a unique, human-readable **batch ID** and a **QR code** that opens its tracking page.

### Batch ID format

`PB-XXXX-XXXX`, for example `PB-7K2M-9QXD`.

- `PB` is a fixed prefix.
- Each `X` is one of 32 Crockford base32 characters: `0–9` and `A–Z` without `I`, `L`, `O` and `U`. The ambiguous characters are left out so IDs are easy to read aloud and type.
- The eight random characters are generated with Python's `secrets` module, so IDs cannot be guessed from registration order.

### How uniqueness is enforced

1. **Generation:** the ID is created during registration and stored in the same transaction as the batch and its `PRODUCT_REGISTERED` event. It is never entered by the farmer.
2. **Database:** `product_batches.batch_code` is `UNIQUE`. A duplicate is rejected by SQLite.
3. **Application:** if a random ID collides with an existing one, a new ID is generated and the insert is retried, up to 10 attempts. If every attempt collides, the request fails with `503`.
4. **Every batch must have an ID:** triggers reject any batch inserted without one, and reject clearing an existing one.

Repeating a registration with the same `Idempotency-Key` returns the same batch and the same ID.

### QR code and tracking URL

The QR code encodes only the batch's tracking URL:

```text
{TRACKING_BASE_URL}/track/{batch ID}
e.g.  http://localhost:5173/track/PB-7K2M-9QXD
```

- `TRACKING_BASE_URL` defaults to `http://localhost:5173`, the address of the Vite dev server that serves the app. To scan with a phone on the same Wi-Fi, set it to this computer's LAN address, for example `http://192.168.1.20:5173`. Startup fails if it is not an absolute `http://` or `https://` URL.
- The QR code contains no user, session, key or other private data.
- The QR is PNG, error-correction level M, generated on demand with the `segno` library. Nothing is written to disk. The same batch always gives the same image.
- **The tracking page at `/track/<batch ID>` is part of US-08.** Until then, the URL opens the app's start page. The QR code already points at the correct address.

### Downloading and viewing the QR code

- In the Farmer workspace, select **View QR** on a batch in the list, or see the confirmation after a registration. The QR image and its tracking URL are shown.
- **Download QR code (PNG)** saves the image as `<batch ID>-qr.png`.
- If the image cannot be loaded, the page shows an error with a **Try again** button.

### Migration and backfill

Running `python scripts/init_db.py` upgrades an existing database in place:

- Batches that already have an ID are not changed.
- Each batch without an ID receives a new unique ID. All assignments commit together or not at all. Running the script again changes nothing.
- Users, events and every other row are kept, and foreign keys are checked.
- The NOT NULL rule is added as triggers on `product_batches`, so no table rebuild is needed.

### Batch and QR endpoints

Farmer session required for every endpoint below. Other roles get `403`, and no session gets `401`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/batches/by-batch-id/<batch ID>` | The farmer's batch with that ID. `400` for a malformed ID, `404` if not found or owned by another farmer |
| GET | `/api/batches/<id>/qr.png` | The QR PNG for the farmer's batch. `?download=1` sends it as an attachment named `<batch ID>-qr.png`. `404` for a missing or foreign batch |

Batch responses now include `batch_id`, `tracking_url` and `qr_code_url`. Existing fields and endpoints are unchanged.

### Limitations

- The tracking page (`/track/<batch ID>`) is not built yet. It belongs to US-08. The QR code and tracking URL are final.
- Batch IDs are random, not sequential. Uniqueness depends on the database constraint and retry, not on the size of the ID space.
- A phone can scan the QR only if it can reach `TRACKING_BASE_URL` on the local network.

## Testing

Backend (pytest, from `backend/`):

```powershell
python -m pytest
```

Frontend (Vitest, from `frontend/`):

```powershell
npm test
```

Production frontend build (from `frontend/`):

```powershell
npm run build
```

## API reference (foundation)

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | API status, application name and database status |
| GET | `/api/roles` | Supported demo roles |
| GET / POST / DELETE | `/api/session` | Read, start or exit the demo role session |
| GET | `/api/role-actions` | Role-specific actions for the active session role |
| POST | `/api/batches` | Farmer registers a product batch (requires `Idempotency-Key`); response includes `batch_id`, `tracking_url`, `qr_code_url` |
| GET | `/api/batches/by-batch-id/<batch ID>` | Farmer looks up one of their batches by its batch ID |
| GET | `/api/batches/<id>/qr.png` | Farmer's QR code image (`?download=1` to download) |
| GET | `/api/batches` | Farmer's own batches |
| GET | `/api/batches/<id>` | One of the farmer's batches |

Errors under `/api/*` are returned as JSON: `{"error": {"code", "name", "message"}}`.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `APP_NAME` | backend | `Blockchain Product Tracking` | Name returned by the health endpoint |
| `DATABASE_PATH` | backend | `instance/product_tracking.db` | SQLite file (relative to `backend/`) |
| `CORS_ORIGINS` | backend | `http://localhost:5173,http://127.0.0.1:5173` | Origins allowed to call `/api/*` |
| `SECRET_KEY` | backend | random per start | Signs the demo session cookie (see Security limitations) |
| `SESSION_COOKIE_SECURE` | backend | `0` | Set `1` only when serving over HTTPS |
| `TRACKING_BASE_URL` | backend | `http://localhost:5173` | Base of the tracking URL encoded in QR codes. Use the LAN address to scan from another device |
| `FLASK_HOST` / `FLASK_PORT` | backend | `127.0.0.1` / `5000` | Development server address |
| `FLASK_DEBUG` | backend | `0` | Enables the Flask debugger when `1` |
| `VITE_API_PROXY_TARGET` | frontend | `http://127.0.0.1:5000` | Backend URL used by the Vite proxy |

Never commit real `.env` files, virtual environments, `node_modules`, SQLite database files, build output or Python cache files.

## Known limitations

- Demo role access has no authentication; see [Security limitations](#security-limitations) under Demo role access.
- No business features yet: no user management, batch management, tracking or ledger logic.
- The `ledger_blocks` table exists but nothing writes to it until the blockchain story is implemented.
- SQLite is single-writer; this is acceptable for the local prototype but not for multi-user production load.
