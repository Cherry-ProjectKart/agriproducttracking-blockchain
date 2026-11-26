# Blockchain Product Tracking

A blockchain-enabled system for tracing agricultural products from farm to retail. Every supply-chain event is recorded in a tamper-evident ledger so that a product's journey can be verified by farmers, distributors, retailers and consumers.

> **Status:** farmer product batch registration (BPT-003, US-02) on top of demo role access (BPT-002, US-01) and the project foundation (BPT-001). QR codes, batch IDs, shipment updates, receipt confirmation and the ledger are not implemented yet.

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

- `batch_code` is now **nullable**. The unique batch identifier belongs to US-03, so batches registered now have no `batch_code` yet.
- `client_request_id` (unique, nullable) was added to store the `Idempotency-Key`.

A registration also writes one `supply_chain_events` row: `event_type` `PRODUCT_REGISTERED`, `actor_role` `farmer`, `status` `Registered`. No ledger block is created; that is US-04.

SQLite cannot drop a `NOT NULL` constraint in place, so the upgrade rebuilds `product_batches` (see `backend/app/migrations.py`). It runs with foreign keys off, copies every row with its original id, checks foreign keys, and only then drops the old table. The upgrade can be run again safely.

### Limitations

- No unique batch ID or QR code yet (US-03). Batches are shown by product name and details, not by identifier.
- The farmer's list is the only batch view. Distributor and Retailer lists belong to later stories.
- The role check follows the BPT-002 demo model. It is not authentication (see Demo role access).

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
| POST | `/api/batches` | Farmer registers a product batch (requires `Idempotency-Key`) |
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
| `FLASK_HOST` / `FLASK_PORT` | backend | `127.0.0.1` / `5000` | Development server address |
| `FLASK_DEBUG` | backend | `0` | Enables the Flask debugger when `1` |
| `VITE_API_PROXY_TARGET` | frontend | `http://127.0.0.1:5000` | Backend URL used by the Vite proxy |

Never commit real `.env` files, virtual environments, `node_modules`, SQLite database files, build output or Python cache files.

## Known limitations

- Demo role access has no authentication; see [Security limitations](#security-limitations) under Demo role access.
- No business features yet: no user management, batch management, tracking or ledger logic.
- The `ledger_blocks` table exists but nothing writes to it until the blockchain story is implemented.
- SQLite is single-writer; this is acceptable for the local prototype but not for multi-user production load.
