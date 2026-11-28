# Blockchain Product Tracking

A blockchain-enabled system for tracing agricultural products from farm to retail. Every supply-chain event is recorded in a tamper-evident ledger so that a product's journey can be verified by farmers, distributors, retailers and consumers.

> **Status:** Ledger integrity and event recording (BPT-108); Distributor shipment lifecycle and movement management (BPT-107); Farmer batch registration and management (BPT-105); user profile and account settings (BPT-104); role-specific workspaces and responsive grids (BPT-103); strict role isolation and protected workspaces (BPT-102); account registration and sign-in (BPT-101), replacing the earlier role selector; consumer QR tracking (BPT-009, US-08) on top of batch history and ledger integrity verification (BPT-008, US-07), retailer receipt confirmation (BPT-007, US-06), distributor shipment updates (BPT-006, US-05), the local hash-linked ledger (BPT-005, US-04), unique batch IDs and QR codes (BPT-004, US-03), farmer batch registration (BPT-003, US-02), demo role access (BPT-002, US-01) and the project foundation (BPT-001).

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

## Accounts, sign-in and demo access (BPT-101)

Each person who takes part in the supply chain registers an account with one role: **Farmer**, **Distributor** or **Retailer**. Consumers do not need an account; they open the public tracking page from a QR code.

### Registration and sign-in

1. Open the application. The sign-in page is shown when nobody is signed in.
2. Select **Create an account**. Enter your full name, a username, a password (twice) and choose a role.
3. Passwords must be 8 to 128 characters and include a letter and a number. Usernames are 3 to 32 characters: letters, numbers, dots, underscores or hyphens, starting with a letter or number. Usernames are not case-sensitive and are stored in lower case, so `Asha.Farmer` and `asha.farmer` are the same account.
4. On success the account is signed in and its role workspace opens.
5. To sign in later, use **Sign In** with your username and password. The role comes from your account; it cannot be chosen on the sign-in page.
6. **Sign out** ends the session. The account and its records are kept.

A signed-in session survives a page refresh. It lasts `SESSION_LIFETIME_HOURS` (12 hours by default) and then asks you to sign in again.

### Demo accounts for the college demonstration

The database has three demo accounts: `demo.farmer`, `demo.distributor` and `demo.retailer`. Their passwords come from environment variables and are stored only as hashes.

1. Copy `backend/.env.example` to `backend/.env` and set `DEMO_FARMER_PASSWORD`, `DEMO_DISTRIBUTOR_PASSWORD` and `DEMO_RETAILER_PASSWORD` (each at least 8 characters, with a letter and a number).
2. Run `python scripts/init_db.py` from `backend/`. It creates the accounts and sets their passwords. It prints a warning for any demo account still without a password.
3. Sign in on the sign-in page with the username (for example `demo.distributor`) and the password you set.

Restarting the backend does not change a demo password that is already stored. To set a new one, clear the stored hash first (`UPDATE users SET password_hash = NULL WHERE username = 'demo.farmer';`) and run `init_db.py` again.

Who may use which workspace and endpoint is documented in [docs/security/ROLE_AUTHORIZATION_MATRIX.md](docs/security/ROLE_AUTHORIZATION_MATRIX.md) (BPT-102).

### Farmer batch registration and management (BPT-105)

- **Registering:** the form asks for product name, description (optional), quantity, unit, origin or farm location, and harvest or registration date. The unit field suggests common units but accepts any short text. Quantity must be above zero and at most 1,000,000,000. Each submission has its own key, so a repeated submit returns the same batch rather than creating a second one.
- **Your batches:** the list shows each batch ID, product, quantity, origin, harvest date, status and registration time. **View QR** shows the batch's QR code; **History** opens its registration, shipment and receipt history below.
- **Editing:** after registration, only the **description** can be changed. The product name, quantity, unit, origin and harvest date are recorded on the ledger when the batch is registered, so they cannot be changed. Changing the description does not change the batch ID, QR code, tracking page, ledger, history, shipments or receipts, and it adds no ledger block.

A farmer can read and edit only their own batches. Another farmer's batch returns "Batch not found", whether or not it exists.

| Method | Path | Description |
|---|---|---|
| PATCH | `/api/batches/<id>` | Change `description` of one of your batches (`id` is the row id). Any other field is refused with 400 |

### Profile and account settings (BPT-104)

Every signed-in user can open **Account settings** from the header (`/account`, any role). The page has three sections:

- **Profile:** full name and username can be changed. The role and the account creation date are shown read-only. Usernames stay unique (any letter case).
- **Preferences:** table density, comfortable or compact. It applies to the account that saved it, and other accounts are unaffected.
- **Change password:** requires the current password. The new password must meet the registration rules and differ from the current one. Other sessions stay valid after a change, because sessions are not tied to the password.

Email addresses and theme or notification settings are not part of this version: the account model has no email field, the design has no dark theme, and there is no notification system.

Database change: `users` gains `grid_density` (`comfortable` by default). It is added to existing databases by `init_db` without changing other rows.

| Method | Path | Description |
|---|---|---|
| GET | `/api/account` | The signed-in account's profile and preferences |
| PATCH | `/api/account` | Change `full_name` and/or `username`. Any other field, including `role` and `id`, is rejected |
| PATCH | `/api/account/preferences` | Change `grid_density` (`comfortable` or `compact`) |
| POST | `/api/account/password` | Change the password: `current_password`, `new_password`, `confirm_password` |

These endpoints take no user id. They act only on the account behind the session, so a request cannot reach another account. `GET /api/session` also reports `grid_density` for the signed-in account.

### Role workspaces (BPT-103)

Each role has its own address: `/farmer`, `/distributor` and `/retailer`. Signed-in users are sent to their own workspace, and every workspace has section links at the top; the link for the current section is highlighted. Summary figures are counted from the batches the workspace has already loaded from the API. Tables scroll inside their own card on narrow screens, and their header row stays visible. Consumers use the public tracking page at `/track/<batch ID>` and need no account.

### Account API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/accounts` | none | Register `{full_name, username, password, confirm_password, role}`. `201` and signed in; `400` with field `details`; `409` when the username is taken |
| POST | `/api/session` | none | Sign in `{username, password}`. `200` with the session; `400` for missing fields; `401` for wrong credentials (same message for an unknown username); `403` for a disabled account |
| GET | `/api/session` | none | Current sign-in: `active`, `role`, `role_label`, `display_name`, `username` |
| DELETE | `/api/session` | none | Sign out. Idempotent |
| GET | `/api/roles` | none | The three operational roles |
| GET | `/api/role-actions` | signed in | Actions for the signed-in role. `401` when signed out |

Responses never include a password or a password hash. Role checks (`require_role`) read the role from the database on every request.

### Security notes

- Passwords are hashed with Werkzeug's salted scrypt (`generate_password_hash`). No new dependency was added.
- The session cookie is signed with `SECRET_KEY`, `HttpOnly` and `SameSite=Lax`. It stores only the account id and the time of sign-in.
- Sign-in does not reveal whether a username exists, and it spends similar time on unknown usernames.
- Set `SECRET_KEY` in `backend/.env` for sessions that survive a backend restart. Without it a random key is used, so sessions end when the backend restarts.
- Limitations: no rate limit on sign-in, no CSRF token, no password reset, no email address, and cookies are not `Secure` on localhost (set `SESSION_COOKIE_SECURE=1` only over HTTPS).

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

A registration also writes one `supply_chain_events` row: `event_type` `PRODUCT_REGISTERED`, `actor_role` `farmer`, `status` `Registered`. It also appends one ledger block (BPT-005, see Local ledger).

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
- **The tracking page at `/track/<batch ID>` is the public consumer page** (see Consumer QR tracking). It needs no login. The QR code points at the correct address.

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

- The tracking page (`/track/<batch ID>`) is described in Consumer QR tracking. The QR code and tracking URL format are final.
- Batch IDs are random, not sequential. Uniqueness depends on the database constraint and retry, not on the size of the ID space.
- A phone can scan the QR only if it can reach `TRACKING_BASE_URL` on the local network.

## Local ledger (US-04)

Each product registration is recorded in a local, hash-linked ledger. The ledger is a sequence of blocks in SQLite. Each block contains a SHA-256 hash of its own contents and the hash of the block before it, so a change to any stored block can be detected. This is an academic demonstration in one local application. It is not a distributed blockchain.

### Block structure

| Field | Meaning |
|---|---|
| `index` | Sequential block number, starting at 0 |
| `timestamp` | UTC time the block was created (for backfilled blocks: the event's own time), e.g. `2026-11-26T16:44:53.477Z` |
| `event_data` | The recorded event as canonical JSON (see below) |
| `previous_hash` | `block_hash` of the block at `index - 1` |
| `block_hash` | SHA-256 of this block's input (see below). Not part of its own input |
| `event_id` | The `supply_chain_events` row the block records (unique: one event, one block) |

A `PRODUCT_REGISTERED` event's data contains: `event_type`, `event_id`, `batch_id`, `actor_role` (`farmer`), `status` (`Registered`), `product_name`, `quantity`, `unit`, `origin` and `harvest_date`. It contains no user names, session values or keys.

### Genesis convention

Block 0 is created when the database is initialised, before any event:

- `index` 0, `timestamp` `1970-01-01T00:00:00.000Z` (fixed), `event_data` `{"event_type":"GENESIS"}`, `previous_hash` 64 zero characters.
- Its `block_hash` is `20966f2f77cdf6f44a9c38308e39ea2640d576a436e401f39504c3de9447f603`.

### Hash calculation

1. **Event data** is serialised as canonical JSON: keys sorted, no spaces (`separators=(",", ":")`), non-ASCII characters kept as UTF-8, no `NaN` or `Infinity`. Example: `{"event_type":"GENESIS"}`.
2. **Hash input** is this canonical JSON text, built from four fields. Keys appear in this order:

   ```text
   {"event_data":<event data text as a JSON string>,"index":<index>,"previous_hash":"<previous hash>","timestamp":"<timestamp>"}
   ```

   The `event_data` value is the stored event text encoded again as a JSON string. The `block_hash` is not included.
3. **Block hash** is `SHA-256(UTF-8 bytes of the hash input)`, written as 64 lowercase hex characters. The code uses Python's `hashlib`. It does not use Python's built-in `hash()`.

Changing the event data changes the hash. Changing the previous hash changes the hash. Identical content always gives the same hash. Anyone can recompute a hash from the stored row with the format above.

### Registration integration and transactions

A successful registration writes these rows in one SQLite transaction: the `product_batches` row, the `PRODUCT_REGISTERED` event, and the ledger block. The transaction starts with `BEGIN IMMEDIATE`, so two registrations cannot extend the chain at the same time. If any step fails, the whole transaction is rolled back, so there is never an event without its block or a block without its event.

Idempotency is unchanged from BPT-003. A repeated request with the same `Idempotency-Key` returns the existing batch and creates no batch, event or block.

### Historical backfill and migration

SRS section 7.2 requires each supported event to be in the ledger. Registrations made before this story therefore have blocks added by `python scripts/init_db.py`:

- The `event_id` column and its UNIQUE index are added to `ledger_blocks` with `ALTER TABLE`. The existing rows are kept.
- The genesis block is created if the ledger is empty.
- Each `PRODUCT_REGISTERED` event with no block receives one, processed by event time and then event id. The block uses the event's own timestamp, so the chain follows the order events happened.
- Only registration events are backfilled. Shipment events get their block when they are recorded (BPT-006).
- Running the script again creates nothing. The local database was checked on a copy: 5 existing registrations became 5 blocks after genesis, with valid hashes and links.

### Ledger API (read-only)

Any active demonstration session (Farmer, Distributor or Retailer) can read the ledger, because the SRS gives demonstration participants access to it. Without a session the response is `401`. Nothing can write to the ledger through the API.

| Method | Path | Description |
|---|---|---|
| GET | `/api/ledger` | All blocks in index order, with `count` and `latest` |
| GET | `/api/ledger/latest` | The latest block. `404` if the ledger is empty |
| GET | `/api/ledger/blocks/<index>` | One block by index. `404` if it does not exist |

Each block in a response has: `index`, `timestamp`, `event_type`, `event_id`, `batch_id`, `event_data`, `previous_hash` and `block_hash`.

### Ledger view

The workspace for every role has a **Local ledger** table showing the block number, timestamp, event, batch ID, previous hash and block hash. The page explains what the hashes show. The table shows the ledger only. Verification is a separate action (see Batch history and ledger integrity below).

### What hash linking does and does not prove

- **Does:** any change to a stored block (its event data, index, timestamp or previous-hash link) changes its hash, so it no longer matches the hash stored in the next block. This makes tampering detectable when the chain is recomputed.
- **Does not:** prove that the recorded product facts are true. Hashing shows the record did not change, not that the farmer's information was correct.
- **Does not:** provide decentralised immutability. The chain lives in one local SQLite database. Anyone with write access to that file could rewrite the whole chain, and the ledger has no independent copies or consensus. The SRS says this explicitly.
- No wallets, tokens, mining, consensus or public network are involved.

## Distributor shipment updates (US-05, BPT-107)

A distributor moves a registered batch through its shipment lifecycle. Each movement changes the batch's status, adds a shipment event, and adds a block to the local ledger. The batch's full movement history stays visible in order.

### Workflow

1. Choose **Distributor** on the role screen. The workspace lists every registered batch with its batch ID, product, origin, quantity, current status and **next movement**.
2. Select a batch that has a next movement. Batches with no further movement are shown but cannot be selected.
3. The **Shipment details** card shows the batch's product, origin, quantity, harvest date, registration time, current status and next movement. It also links to the batch's public tracking page (`/track/<batch ID>`).
4. The **Movement history** card shows the batch's registration, shipment and receipt events in order.
5. The status is set to the batch's next movement. Optionally add a short note, then select **Save shipment update**.
6. A confirmation appears, saying which movement will be recorded and that it cannot be undone. Select **Confirm and record** to save it, or **Cancel** to change nothing. Nothing is sent before you confirm.
7. On success, the confirmation shows the new status, the ledger block number, the event time and the block hash. The batch list, details and history are refreshed.

### Shipment lifecycle

Batches move through one ordered sequence. A batch moves one step at a time:

| Current status | Next movement the distributor may record |
|---|---|
| `Registered` | `Shipped` |
| `Shipped` | `In Transit` |
| `In Transit` | `Delivered to Retailer` |
| `Delivered to Retailer` | none. The retailer then confirms receipt (US-06) |
| `Received by Retailer` | none |

- A batch cannot skip a step, go backwards, or repeat a status. For example, `Registered` to `In Transit`, or `In Transit` back to `Shipped`, is refused with `409` and nothing is written.
- Choosing *Delivered to Retailer* does not mark the batch as received. That happens only when a retailer confirms receipt (US-06, see Retailer receipt confirmation below).
- The rule is checked on the server inside the same transaction that writes the movement. Two requests for the same batch cannot both pass the check.

#### Legacy and unexpected statuses

- A batch whose status is the schema default `CREATED` (written before the registration status was set explicitly) is treated as registered, so it can still be shipped.
- A batch with any other status that has no next movement stays visible and its history stays readable. The distributor cannot record a new movement for it, and the workspace shows **None** as its next movement.
- No existing shipment, event or block is changed or removed when the rule is applied. Earlier records were written under the previous behaviour and are kept as they are.

### Optional note

- Optional. Leave it empty to record no note.
- Trimmed. A note that is only spaces is stored as no note.
- At most 300 characters, and one line of plain text. Line breaks and other control characters are refused with a clear message.

### Event and ledger integration

Each successful movement creates:

- One `supply_chain_events` row: `event_type` `SHIPMENT_UPDATED`, `actor_role` `distributor`, the new `status`, the `note` and `event_timestamp`.
- One ledger block whose event data contains `event_type`, `event_id`, `batch_id`, `actor_role`, `status`, `note` and `event_timestamp`. The block is linked to the previous block with the same hashing used for registrations (see Local ledger).

Movement history and the ledger agree: each shipment event has exactly one block, and the full chain verifies after every movement. Earlier blocks are never changed by a new movement.

### Transactions, rollback and repeated requests

The status check, the batch status update, the event and the ledger block are written in one SQLite transaction. The transaction starts before the current status is read (`BEGIN IMMEDIATE`). If any step fails, everything is rolled back, so no status change, event or block is left behind.

Each request requires an `Idempotency-Key` header. Repeating the same request returns the existing movement (`200`) and writes nothing. Reusing the key for a different batch, status or note returns `409`. Sending a new key for a movement that has already happened returns `409` because that movement is no longer allowed, and nothing is written.

### Public tracking

The public tracking page at `/track/<batch ID>` reads the same history. After a successful movement it shows the new current status and the new event, in order. The page is read-only: it cannot record or change anything, and it shows no account or user information.

### Role restrictions and ownership

- Only an active **Distributor** session can list batches for shipment or record a movement. Farmer and Retailer sessions get `403`, and a request with no session gets `401`.
- The distributor is taken from the signed session, never from the request body.
- The Farmer's batch endpoints (`/api/batches`, QR codes) are unchanged. The distributor's batch list does not include the farmer's identity.
- Only the Distributor workspace shows the shipment form.
- **Shared access (existing model, unchanged):** the data model records the role of each shipment event, not the individual distributor. Any distributor can move any registered batch, and the workspace lists all batches. This matches the existing demonstration model. Per-distributor ownership would need a new field and was not introduced in this story.

### API

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/shipments/batches` | Distributor | Registered batches, with `next_statuses` for each (no farmer identity) |
| POST | `/api/shipments` | Distributor, `Idempotency-Key` required | Body `{"batch_id", "status", "note"?}`. `201` created, `200` repeated request, `400` invalid input (with `error.details`), `404` unknown batch, `409` movement not allowed from the batch's current status, or key reused for different details |

Successful responses contain `batch` (`batch_id`, `current_status`), `event` (`event_id`, `event_type`, `actor_role`, `batch_id`, `status`, `note`, `timestamp`) and `ledger_block` (`index`, `block_hash`, `previous_hash`).

A `409` for a movement that is not allowed gives the reason, for example: `PB-7N6P-M0SK is In Transit. The next shipment update for it is Delivered to Retailer.`

### Database changes

- None in BPT-107. The schema, migrations and existing rows are unchanged, and no migration runs. The lifecycle is enforced in code against the existing `product_batches.current_status` values.
- Earlier, under US-05: `supply_chain_events` gained `client_request_id` (the idempotency key), added with `ALTER TABLE` and a UNIQUE index. Existing events keep `NULL`.

### Known limitations

- Shared access: any distributor can move any batch (see Role restrictions and ownership).
- The lifecycle is a single sequence. A batch that was actually shipped to a warehouse and back cannot be represented; a correction would need a new event type, which is outside this story.
- Movements are not reversible from the workspace. A mistaken movement stays on the ledger, and the next valid step is the only one offered.

## Retailer receipt confirmation (US-06)


A retailer confirms that a batch has arrived. The batch then moves from `Delivered to Retailer` to `Received by Retailer`, and the confirmation is recorded in the ledger.

### Workflow

1. Choose **Retailer** on the role screen. The workspace lists the batches awaiting receipt: those whose status is `Delivered to Retailer`. Each row shows the batch ID, product, origin, quantity and current status.
2. Select a batch. The panel states that its status will change to `Received by Retailer`.
3. Select **Confirm receipt**. The button shows *Confirming…* until the server answers.
4. On success, the confirmation shows the batch ID, the new status, the ledger block number and its hash. The batch leaves the list.

Batches that are `Registered`, `Shipped` or `In Transit` are not awaiting receipt, and the API refuses to confirm them. A batch that is already received cannot be confirmed again.

### Business rule

| Actor | Action | Result |
|---|---|---|
| Retailer | Confirm receipt of a `Delivered to Retailer` batch | `Received by Retailer`; `RECEIPT_CONFIRMED` event; one ledger block |

The retailer is taken from the signed demo session. The request body cannot set the actor.

### Recording and atomicity

A confirmation writes three things in one SQLite transaction (`BEGIN IMMEDIATE`): the batch status change, the `RECEIPT_CONFIRMED` event, and the ledger block. The eligibility check runs inside that transaction, so two confirmations at the same time cannot both succeed. If the ledger block cannot be written, the status change and the event are rolled back as well. The batch then remains `Delivered to Retailer`.

The event has `actor_role` `retailer`, `status` `Received by Retailer` and the event timestamp. Its ledger block has the same event data and links to the block before it, using the same hashing as the other events (see Local ledger).

### Repeated requests

Like the other write endpoints, confirmation requires an `Idempotency-Key` header. Sending the same key again returns the stored receipt (`200`) and writes nothing. Sending a new key for a batch that is already received returns `409`, so a second receipt is never recorded.

### Role restrictions

- Only an active **Retailer** session can list awaiting batches or confirm receipt. Farmer and Distributor sessions get `403`. No session gets `401`.
- The Retailer panel is shown only in the Retailer workspace, and only that role loads its data.
- The awaiting list contains no farmer identity.

### API

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/receipts/awaiting` | Retailer | Batches with status `Delivered to Retailer` |
| POST | `/api/receipts` | Retailer, `Idempotency-Key` required | Body `{"batch_id": "PB-XXXX-XXXX"}`. `201` confirmed, `200` repeated request, `400` invalid or missing batch ID, `404` unknown batch, `409` not awaiting receipt, already received, or key reused for another batch |

Successful responses contain `batch` (`batch_id`, `current_status`), `event` (`event_id`, `event_type`, `actor_role`, `batch_id`, `status`, `timestamp`) and `ledger_block` (`index`, `block_hash`, `previous_hash`).

### Database changes

None. The existing `product_batches.current_status`, `supply_chain_events` (including the request key from BPT-006) and `ledger_blocks` store the receipt. The schema is unchanged, and `init_db` on an existing database leaves its data and schema as they were.

### Limitations

- Receipt is recorded only as a status change and an event. The retailer cannot add a note, and there is no receipt history view. The ledger view shows the event.
- The demo cannot prove that the physical goods arrived. The ledger records the confirmation, not the goods.

## Ledger integrity and event recording (BPT-108)

This section describes the ledger as implemented. The sections above (US-04, US-07) cover the ledger table, the API and the views in more detail.

### What the ledger is

The ledger is a local, hash-linked record stored in one SQLite table, `ledger_blocks`, in the demonstration database. Each block stores one application event. Changing a stored block changes its hash, which no longer matches the link in the next block, so the change can be detected.

This is **not a decentralized blockchain network**. There is one database, one application, no peers, no consensus, no tokens and no external infrastructure. Whoever controls the database file controls the ledger.

Hash verification shows that recorded data has not been modified since it was written. It does **not** prove that the product information was true when it was entered.

### Genesis and subsequent blocks

- **Genesis (block 0)** is created before the first event. Its index is 0, its timestamp is `1970-01-01T00:00:00.000Z`, its event data is `{"event_type":"GENESIS"}`, and its previous hash is 64 zero characters. The verifier checks each of these values. The genesis block references no supply-chain event.
- **Each later block** gets the next index, the timestamp of its event, the canonical event data, the hash of the block before it, and its own hash.
- Block indexes are unique in the table, and the verifier checks that they run 0, 1, 2, … with no gap or repeat.

### How an application event becomes a block

Every lifecycle operation that records an event follows the same steps, inside one write transaction (`BEGIN IMMEDIATE`):

1. The request is validated and the caller's role and ownership are checked.
2. The application record is written (a new batch, a new status, or a new receipt status).
3. One `supply_chain_events` row is inserted with the event type, actor role, status and the event timestamp.
4. One ledger block is appended. Its event data is built from the event and its record, its index and previous hash come from the latest block, and its hash is calculated on the backend.
5. The transaction is committed. If any step fails, everything is rolled back, so no record, event or block is left behind.

| Operation | Event type | Block event data |
|---|---|---|
| Farmer registers a batch | `PRODUCT_REGISTERED` | event id, batch ID, actor `farmer`, status, product name, quantity, unit, origin, harvest date |
| Distributor records a movement | `SHIPMENT_UPDATED` | event id, batch ID, actor `distributor`, status, note, event timestamp |
| Retailer confirms receipt | `RECEIPT_CONFIRMED` | event id, batch ID, actor `retailer`, status, event timestamp |

Not recorded in the ledger: a failed request, an idempotent replay of a request that already succeeded, a description edit, a QR download, and any read-only view. The tests check each of these.

**Timestamps.** The event and its block share one timestamp for registrations, shipments and receipts. Registrations made before BPT-108 keep the times they were stored with. Their blocks were not rewritten, and the verifier does not compare registration timestamps.

### SHA-256 and previous-hash linking

The block hash is SHA-256 over the UTF-8 bytes of this canonical JSON text:

```
{"event_data":<stored event JSON as a string>,"index":<index>,"previous_hash":"<64 hex>","timestamp":"<UTC ISO>"}
```

- Canonical JSON means sorted keys, no spaces, and non-ASCII characters kept as UTF-8.
- The block's own hash is not part of its hash input.
- Each block's `previous_hash` is the `block_hash` of the block before it. The genesis block's previous hash is 64 zeros.

The hash algorithm and serialization are unchanged from BPT-005. Existing hashes are not recalculated.

### Verifying the ledger

- **API:** `GET /api/ledger/verify`. Any signed-in demonstration session can call it. It is read-only: the verifier runs with `PRAGMA query_only` and writes nothing.
- **Interface:** the **Verify ledger** button in the Ledger integrity section of the workspace. The result shows *valid* or *invalid*, the number of blocks checked, the first failing block and the reason for each failure.
- **Automated tests:** `python -m pytest tests/test_ledger_integrity.py -q` (run from `backend/`).

The verifier runs these checks, in this order:

| Check | What it detects |
|---|---|
| `genesis` | Missing or altered genesis block, or a second block claiming index 0 |
| `sequence` | Missing, repeated or reordered block indexes |
| `canonical_data` | Event data that is not valid canonical JSON |
| `timestamps` | Timestamps not in the stored UTC millisecond format |
| `hash_format` | Hashes that are not 64 lowercase hexadecimal characters |
| `previous_hash_links` | A block whose previous hash is not the recalculated hash of the block before it |
| `block_hashes` | A stored block hash that does not match the recalculated hash |
| `event_references` | A block that names an event which does not exist, or names a different event, type or batch |
| `event_uniqueness` | An event referenced by more than one block |
| `event_consistency` | A block whose status, actor, note, timestamp or (for registrations) product facts differ from the stored event and batch |
| `event_coverage` | A supported event (registration, shipment, receipt) that has no block |

The result also reports the number of blocks checked, the latest index, the first failing block, the recalculated latest hash and the verification time. The verifier never repairs or rewrites a chain.

### Tampering demonstration

The tampering tests run only against temporary databases that the tests create. They never change the demonstration database, and no interface control can change the ledger.

Each scenario changes a copy of a valid ledger and checks that the verifier reports it:

- editing a stored event payload (detected by `block_hashes` and `event_consistency`);
- changing a block hash (`block_hashes`);
- changing a previous hash (`previous_hash_links`);
- deleting a middle block (`sequence`, `previous_hash_links`);
- deleting the last block (`event_coverage`, because the chain alone cannot show that its final block is missing);
- removing a block's event reference (`event_coverage`);
- pointing a block at a missing event (`event_references`);
- referencing one event from two blocks (`event_uniqueness`, with the unique index removed in the test copy);
- altering the genesis block (`genesis`);
- changing an event row after its block was written (`event_consistency`);
- editing a block and recalculating every hash after it (`event_consistency`, because the event record still holds the original values).

What these prove: a change to recorded data, to a link, or to the events that describe the records is detectable. What they do not prove: that someone who rewrites every block and every matching event row produces a chain that fails verification. Only an external anchor, such as a hash published elsewhere, could reveal that, and this demonstration has none.

### Transactions, concurrency and failures

- Each write takes the database write lock up front (`BEGIN IMMEDIATE`), so two writes cannot both extend the same chain tip.
- A forced failure at each stage of a registration, a shipment and a receipt (batch or status update, event insert, block insert) leaves no batch change, event or block. The tests install a failure in the database at each stage, check that the database is unchanged, then retry the same request successfully.
- Four threads, each registering five batches on its own connection, produce block indexes 0 to 20 with no gap or repeat, and the chain verifies.

### Limitations of a local, centralised ledger

- Whoever has write access to the database can rebuild a consistent chain. Hashes detect changes; they do not prevent them.
- Blocks record the actor's role, not which user acted.
- There is no external anchoring, signing or key management.
- A removed last block is reported only through its missing event, not through the chain itself.
- Hashes prove that data has not changed since it was written. They do not prove that the product information was true.

### Historical data

BPT-108 added no database migration and changed no existing block. Registrations made before this story keep their stored timestamps and hashes. On a copy of the demonstration database, the verifier reports the existing 14 blocks as valid under the new checks.

## Batch history and ledger integrity (US-07)

A reviewer can see what happened to a batch, and check that the local ledger has not been altered. Both features are read-only. This is a local hash-linked ledger demonstration: it stores its records in one SQLite file on this computer. It is not a decentralised or public blockchain, and it cannot prove that the recorded facts are true.

### Batch history

Open the **Batch history** panel in any workspace and enter a batch ID such as `PB-7K2M-9QXD`. The panel lists the batch's events in order:

| Event | Label | Recorded by | Status shown |
|---|---|---|---|
| `PRODUCT_REGISTERED` | Registration | Farmer | `Registered` |
| `SHIPMENT_UPDATED` | Shipment | Distributor | `Shipped`, `In Transit` or `Delivered to Retailer` |
| `RECEIPT_CONFIRMED` | Receipt | Retailer | `Received by Retailer` |

Each event shows its actor role, status, note (or "No note"), timestamp and the ledger block that records it.

- Events are ordered by their timestamp, then by event ID. The order is the same every time.
- Only events for the requested batch are listed. Each event appears once.
- An unknown batch ID shows "No batch has the ID …". A malformed ID is refused before any request is sent.
- A batch with no events shows an empty message.

### Ledger integrity verification

Select **Verify ledger** in any workspace. The server reads every block and recalculates its hash from the stored contents, using the same algorithm and canonical serialisation as the ledger itself (BPT-005). The stored block hashes are not trusted. Nothing is repaired, changed or appended.

The checks, in the order they run:

| Check | What it confirms |
|---|---|
| Genesis block | Block 0 has the documented timestamp, event data `{"event_type":"GENESIS"}` and a previous hash of 64 zeros |
| Sequential block indexes | Blocks are numbered 0, 1, 2, … with no gaps, repeats or reordering |
| Canonical event data | Each block's stored event data is valid JSON in canonical form, which is what is hashed |
| Timestamp format | Each timestamp is UTC with milliseconds and a `Z` suffix |
| Hash format | Each stored hash is 64 lowercase hexadecimal characters |
| Previous-hash links | Each block's previous hash equals the **recalculated** hash of the block before it |
| Block hashes recalculated | Each block's stored hash equals the hash recalculated from its contents |
| Event references | A block that names a supply-chain event refers to a real event with the same ID, type and batch |
| Every supported event has a block | Each registration, shipment and receipt event has exactly one block |

### Valid and Invalid outcomes

- **Valid:** every check passed for every block. The panel says how many blocks passed.
- **Invalid:** at least one check failed. The panel names the first failing block, lists each failure with its block number and reason, and shows which checks passed or failed. Failures that are not tied to one block (for example a missing block) are labelled "Ledger-wide".
- The result is shown only after the server has finished the check. A network or server error is shown as an error, not as a result.

Because links are checked against recalculated hashes, changing a stored block is detected even when its stored hash is changed to match. A change to a block shows as a failed block hash, and it also breaks the next block's link when the stored hash is left in place.

### Tested tampering

The test suite and a copy of the local database were checked with these changes. In each case the verifier reported Invalid and named the block:

- a changed event payload
- a changed timestamp
- a changed stored block hash
- a broken previous-hash link
- a deleted block (a gap in the indexes, a broken link, and an uncovered event)
- swapped block indexes
- a changed genesis block
- event data that is not in canonical form
- an empty ledger

The live database was never modified by these checks.

### API

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/history/<batch ID>` | Any active session | Chronological events for one batch. `400` malformed ID, `404` unknown batch |
| GET | `/api/ledger/verify` | Any active session | Runs the full ledger check. Returns `200` for both Valid and Invalid results. `401` without a session |

Example result from `/api/ledger/verify`: `{"result": "valid", "checked_blocks": 18, "latest_block_index": 17, "recalculated_latest_hash": "…", "first_failing_block": null, "checks": [{"id", "label", "passed"}], "failures": [], "verified_at": "…"}`. For an invalid ledger, `result` is `"invalid"` and `failures` lists `{"block_index", "check", "reason"}` entries.

### Limitations

- Verification proves that the stored records still match their hashes and links. It cannot prove that a farmer, distributor or retailer recorded true information.
- The ledger lives in one SQLite file. Anyone with write access to that file can rewrite the whole chain and recalculate every hash. The ledger has no independent copies, consensus or outside witness. Verification detects edits made without recalculating the chain.
- Verification is run on request. Nothing runs automatically, and the result is not stored.
- The history and verification views are available to every demonstration role. There is no reviewer role.

## Consumer QR tracking (US-08)

A consumer scans a batch's QR code and sees its details and journey. The tracking page is public and read-only: it needs no login and no role.

### The tracking URL and the page

The QR code encodes `{TRACKING_BASE_URL}/track/{batch ID}`, for example `http://localhost:5173/track/PB-7K2M-9QXD`. The address opens the **consumer tracking page** in the frontend. That page is separate from the workspace: it does not load the demo session, the role screen or the workspace, and it has no buttons, forms or links that change anything.

The page shows:

- the batch ID, product name, origin or farm location, and current status
- the chronological journey: each registration, shipment and receipt event, with the recorded-by role, status, note (when there is one), timestamp and ledger block number
- clear messages for an unknown batch, a malformed code, and a server that cannot be reached

The page sets the browser title to `Batch <ID> · Product tracking`. It is designed for phone screens first and widens on larger screens.

### Public tracking endpoint

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/tracking/<batch ID>` | **Public**: no session, no login | Batch details and recorded history. `400` malformed ID, `404` unknown batch |

Response:

```json
{
  "batch": {"batch_id": "PB-7K2M-9QXD", "product_name": "Organic Tomatoes", "origin": "Hill Top Farm, Plot 2", "current_status": "Received by Retailer"},
  "count": 4,
  "events": [
    {"event_type": "PRODUCT_REGISTERED", "label": "Registration", "actor_role": "farmer", "status": "Registered", "note": null, "timestamp": "2026-11-26T17:52:00.787Z", "ledger_block_index": 19}
  ]
}
```

The endpoint reuses the batch history service from BPT-008 and keeps only the fields above. It sets `Cache-Control: no-store`, sets no cookie, and accepts only `GET` (other methods return `405`).

**Exposed:** the batch ID, product name, origin, current status, and for each event its type, label, actor role, status, note, timestamp and ledger block index.

**Not exposed:** the farmer's or any user's identity or ID, session data, tokens, secrets, the internal row IDs of batches and events, request keys, the ledger hashes and payloads, or any other database record. This list is enforced by a test that checks the response keys and the text of the response.

Every other endpoint keeps its role protection. The public endpoint does not change the session of anyone who is signed in, and it cannot create or change events.

### How the QR code works

- The QR image is generated by the backend for the farmer's batch (`GET /api/batches/<id>/qr.png`, farmer only, see Unique batch IDs and QR codes). Its content is only the tracking URL.
- The tracking URL is built from `TRACKING_BASE_URL`. The default is `http://localhost:5173`, the address of the frontend. Nothing in the code contains a machine-specific address.
- The QR image decodes to exactly the tracking URL in the batch response. The test suite decodes the real PNG to check this.
- The image is generated on request from the batch's own ID and the current `TRACKING_BASE_URL`. Nothing is written to the database, so viewing or downloading a QR code any number of times creates no batch, event or ledger block.
- The QR image is a PNG at 8 pixels per module with a 4-module quiet zone, and is shown at 200 pixels wide. It is sized for printing at about 2 cm or more.

### Downloading and sharing a batch QR code (BPT-106)

Open **View QR** on a batch in the Farmer workspace. The batch details then offer three things:

- **Download QR code (PNG)** saves the image. The file is named with the batch ID and the product, for example `PB-7K2M-9QXD-basmati-rice-qr.png`. If the product name has no letters or digits that can be used in a file name, the name is just `PB-7K2M-9QXD-qr.png`. A message confirms the download or reports that it failed.
- **Copy tracking link** copies `{TRACKING_BASE_URL}/track/<batch ID>` to the clipboard. Where the browser does not allow clipboard access (for example on a plain-HTTP address other than localhost), the link is selected and copied through a fallback. If that also fails, a message asks you to copy it by hand.
- The tracking link is shown under the image, so it can be read out or typed in.

Only the signed-in farmer who owns the batch can download the image (`GET /api/batches/<id>/qr.png`, or add `?download=1` for an attachment). Other farmers get `404`, and distributors and retailers get `403`. The image contains only the tracking URL: no user, session, token or internal ID.

**Localhost demonstration:** run the backend and frontend as described under Running the application, sign in as **Farmer**, open **View QR** on a batch, download the PNG, and open the tracking link in a browser on the same computer.

### Demonstrating it on this computer

1. Start the backend and the frontend (see Running the application).
2. Sign in as **Farmer**, register a batch and select **View QR** on it.
3. Open the batch's tracking link on the same computer: `http://localhost:5173/track/<batch ID>`. The tracking page opens without a login.
4. Optional: sign in as **Distributor** to record a shipment and as **Retailer** to confirm receipt. Reload the tracking page to see the new events.

### Scanning from another device on the same network

The application runs on this computer only. A phone or other device can scan the QR code and open the page only if it can reach this computer's address on the local network. Nothing in the project contains a fixed address, so set it yourself:

1. Find this computer's local network address (for example with `ipconfig` in PowerShell). Use the IPv4 address of your Wi-Fi or Ethernet adapter. Do not use a value from another project or machine.
2. In `backend/.env`, set `TRACKING_BASE_URL=http://<that address>:5173`. Restart the backend. Every batch's QR image is generated from the current setting, so the QR code shown in the farmer workspace changes for all batches, including those registered earlier. Batch IDs and tracking paths do not change. A QR code that was already printed or saved still encodes the old address, so it opens the tracking page only while that old address is reachable. Print new codes after changing the setting.
3. Start the frontend so that it listens on the network: `npm run dev -- --host`. The Vite dev server then accepts connections from other devices on the network.
4. Allow Node.js or port 5173 through the Windows firewall on the private network if prompted.
5. Connect the phone to the same Wi-Fi network. Scan the QR code, or open `http://<that address>:5173/track/<batch ID>`.

Notes:

- The Flask backend still listens only on `127.0.0.1`, so it is not reachable from the network. The browser calls the backend through the Vite proxy on port 5173, so only that port needs to be reachable.
- This is a localhost demonstration: plain HTTP, no HTTPS, no caching, no authentication for the tracking page.

### Verified behaviour

- Public access without a session: tests check it, and the browser opened the tracking page directly with no login.
- The QR image decodes to the tracking URL, and that URL, used with no session, returns the same batch and journey as the database.
- A complete flow (registration, shipment, delivery to the retailer and receipt) was shown on the tracking page with four events, each with its ledger block.

### Limitations

- The page shows what the local ledger recorded. The record shows that events were entered and not altered. It does not prove that the goods or the information are true.
- The ledger is one local SQLite file, not a decentralised or public blockchain. The integrity check (BPT-008) detects edits that were not followed by recalculating the chain.
- The tracking page is not translated and is designed for English demonstration use.

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
| GET / POST / DELETE | `/api/session` | Read the sign-in state, sign in with username and password, or sign out |
| POST | `/api/accounts` | Register an account (Farmer, Distributor or Retailer) and sign it in |
| GET | `/api/role-actions` | Role-specific actions for the signed-in role |
| POST | `/api/batches` | Farmer registers a product batch (requires `Idempotency-Key`); response includes `batch_id`, `tracking_url`, `qr_code_url` |
| GET | `/api/batches/by-batch-id/<batch ID>` | Farmer looks up one of their batches by its batch ID |
| GET | `/api/batches/<id>/qr.png` | Farmer's QR code image (`?download=1` to download) |
| GET | `/api/shipments/batches` | Distributor's list of registered batches for shipment updates |
| POST | `/api/shipments` | Distributor records a shipment update (requires `Idempotency-Key`) |
| GET | `/api/history/<batch ID>` | Batch history: registration, shipment and receipt events in order (any active role) |
| GET | `/api/ledger/verify` | Independent ledger integrity check: Valid or Invalid with details (any active role) |
| GET | `/api/tracking/<batch ID>` | **Public** consumer tracking: batch details and history. No session needed |
| GET | `/api/receipts/awaiting` | Retailer's batches awaiting receipt |
| POST | `/api/receipts` | Retailer confirms receipt of a batch (requires `Idempotency-Key`) |
| GET | `/api/ledger` | All ledger blocks in order (any active role) |
| GET | `/api/ledger/latest` | Latest ledger block (any active role) |
| GET | `/api/ledger/blocks/<index>` | One ledger block by index (any active role) |
| GET | `/api/batches` | Farmer's own batches |
| GET | `/api/batches/<id>` | One of the farmer's batches |

Errors under `/api/*` are returned as JSON: `{"error": {"code", "name", "message"}}`.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `APP_NAME` | backend | `Blockchain Product Tracking` | Name returned by the health endpoint |
| `DATABASE_PATH` | backend | `instance/product_tracking.db` | SQLite file (relative to `backend/`) |
| `CORS_ORIGINS` | backend | `http://localhost:5173,http://127.0.0.1:5173` | Origins allowed to call `/api/*` |
| `SECRET_KEY` | backend | random per start | Signs the session cookie (see Security notes) |
| `SESSION_LIFETIME_HOURS` | backend | `12` | How long a sign-in lasts (0.1 to 168 hours) |
| `DEMO_FARMER_PASSWORD`, `DEMO_DISTRIBUTOR_PASSWORD`, `DEMO_RETAILER_PASSWORD` | backend | empty | Passwords for the demo accounts, read by `scripts/init_db.py` |
| `SESSION_COOKIE_SECURE` | backend | `0` | Set `1` only when serving over HTTPS |
| `TRACKING_BASE_URL` | backend | `http://localhost:5173` | Base of the tracking URL encoded in QR codes. Use the LAN address to scan from another device |
| `FLASK_HOST` / `FLASK_PORT` | backend | `127.0.0.1` / `5000` | Development server address |
| `FLASK_DEBUG` | backend | `0` | Enables the Flask debugger when `1` |
| `VITE_API_PROXY_TARGET` | frontend | `http://127.0.0.1:5000` | Backend URL used by the Vite proxy |

Never commit real `.env` files, virtual environments, `node_modules`, SQLite database files, build output or Python cache files.

## Known limitations

- Sign-in has no rate limit, CSRF token or password reset; see Security notes under Accounts, sign-in and demo access.
- No user management, consumer accounts or cloud deployment.
- The ledger is a local, single-application hash chain. See Local ledger for what it does and does not prove.
- SQLite is single-writer; this is acceptable for the local prototype but not for multi-user production load.
