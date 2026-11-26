# Blockchain Product Tracking

A blockchain-enabled system for tracing agricultural products from farm to retail. Every supply-chain event is recorded in a tamper-evident ledger so that a product's journey can be verified by farmers, distributors, retailers and consumers.

> **Status:** project foundation (BPT-001). The repository currently contains the project scaffold, database schema, health checks and a status dashboard. Business features (user stories) are not implemented yet.

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

Open <http://localhost:5173>. The dashboard shows the backend API and database status. The Vite dev server forwards `/api/*` requests to Flask, so the browser never calls port 5000 directly.

Health endpoint: `GET http://127.0.0.1:5000/api/health`

- `200` with `"status": "ok"` when the API is running and the database schema is present.
- `503` with `"status": "degraded"` when the database file or schema is missing (run `init_db.py`).

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

Errors under `/api/*` are returned as JSON: `{"error": {"code", "name", "message"}}`.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `APP_NAME` | backend | `Blockchain Product Tracking` | Name returned by the health endpoint |
| `DATABASE_PATH` | backend | `instance/product_tracking.db` | SQLite file (relative to `backend/`) |
| `CORS_ORIGINS` | backend | `http://localhost:5173,http://127.0.0.1:5173` | Origins allowed to call `/api/*` |
| `FLASK_HOST` / `FLASK_PORT` | backend | `127.0.0.1` / `5000` | Development server address |
| `FLASK_DEBUG` | backend | `0` | Enables the Flask debugger when `1` |
| `VITE_API_PROXY_TARGET` | frontend | `http://127.0.0.1:5000` | Backend URL used by the Vite proxy |

Never commit real `.env` files, virtual environments, `node_modules`, SQLite database files, build output or Python cache files.

## Known limitations

- No business features yet: no authentication, user management, batch management, tracking or ledger logic.
- The `ledger_blocks` table exists but nothing writes to it until the blockchain story is implemented.
- SQLite is single-writer; this is acceptable for the local prototype but not for multi-user production load.
