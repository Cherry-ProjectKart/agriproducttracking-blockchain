# Blockchain Product Tracking

A blockchain-enabled system for tracing agricultural products from farm to retail. Every supply-chain event is recorded in a tamper-evident ledger so that a product's journey can be verified by farmers, distributors, retailers and consumers.

> **Status:** basic demo role access (BPT-002, US-01) on top of the project foundation (BPT-001). Business features such as batch registration, QR codes and the ledger are not implemented yet.

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
