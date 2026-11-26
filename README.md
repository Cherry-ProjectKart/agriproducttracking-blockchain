# Blockchain Product Tracking

A blockchain-enabled system for tracing agricultural products from farm to retail. Every supply-chain event is recorded in a tamper-evident ledger so that a product's journey can be verified by farmers, distributors, retailers and consumers.

> **Status:** batch history and ledger integrity verification (BPT-008, US-07) on top of retailer receipt confirmation (BPT-007, US-06), distributor shipment updates (BPT-006, US-05), the local hash-linked ledger (BPT-005, US-04), unique batch IDs and QR codes (BPT-004, US-03), farmer batch registration (BPT-003, US-02), demo role access (BPT-002, US-01) and the project foundation (BPT-001). The consumer tracking page (US-08) is not implemented yet.

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

## Distributor shipment updates (US-05)

A distributor records the shipment or movement status of a registered batch. Each update changes the batch's status, adds a shipment event, and adds a block to the local ledger.

### Workflow

1. Choose **Distributor** on the role screen. The workspace lists every registered batch with its batch ID, product, origin, quantity and current status.
2. Select a batch.
3. Choose a shipment status and, optionally, add a short note.
4. Select **Save shipment update**. The button shows *Saving…* until the server answers.
5. On success, the confirmation shows the new status, the ledger block number, the event time and the block hash. The batch list refreshes to show the new status.

### Supported shipment statuses

| Status | Meaning in this demo |
|---|---|
| `Shipped` | The batch has left the farm or the previous stage |
| `In Transit` | The batch is on its way |
| `Delivered to Retailer` | The batch has been handed to the retailer |

These three values come from the sprint plan (US-05: "Shipped / In Transit / Delivered to Retailer") and the SRS business rules ("Shipped or In Transit"). The same values are used in the form, the API, the database, the event data and the ledger.

Choosing *Delivered to Retailer* does not mark the batch as received. That happens only when a retailer confirms receipt (US-06, see Retailer receipt confirmation below).

Every batch starts as `Registered`. The status changes to the latest shipment status, and each change is kept as its own event.

### Optional note

- Optional. Leave it empty to record no note.
- Trimmed. A note that is only spaces is stored as no note.
- At most 300 characters, and one line of plain text. Line breaks and other control characters are refused with a clear message.

### Event and ledger integration

Each successful update creates:

- One `supply_chain_events` row: `event_type` `SHIPMENT_UPDATED`, `actor_role` `distributor`, the new `status`, the `note` and `event_timestamp`.
- One ledger block whose event data contains `event_type`, `event_id`, `batch_id`, `actor_role`, `status`, `note` and `event_timestamp`. The block is linked to the previous block with the same hashing used for registrations (see Local ledger).

### Transactions, rollback and repeated requests

The batch status update, the event and the ledger block are written in one SQLite transaction (`BEGIN IMMEDIATE`). If any step fails, all three are rolled back, so no status change, event or block is left behind. A test forces a ledger failure and checks that nothing was saved.

Like registration, each update requires an `Idempotency-Key` header. Repeating the same request returns the existing update (`200`) and writes nothing. Reusing the key for a different batch, status or note returns `409`.

### Role restrictions

- Only an active **Distributor** session can list batches for shipment or record an update. Farmer and Retailer sessions get `403`, and a request with no session gets `401`.
- The distributor is taken from the signed session, never from the request body.
- The Farmer's batch endpoints (`/api/batches`, QR codes) are unchanged. The distributor's batch list does not include the farmer's identity.
- Only the Distributor workspace shows the shipment form.

### API

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/shipments/batches` | Distributor | Registered batches for shipment updates (no farmer identity) |
| POST | `/api/shipments` | Distributor, `Idempotency-Key` required | Body `{"batch_id", "status", "note"?}`. `201` created, `200` repeated request, `400` invalid input (with `error.details`), `404` unknown batch, `409` key reused for different details |

Successful responses contain `batch` (`batch_id`, `current_status`), `event` (`event_id`, `event_type`, `actor_role`, `batch_id`, `status`, `note`, `timestamp`) and `ledger_block` (`index`, `block_hash`, `previous_hash`).

### Database changes

- `supply_chain_events` gained `client_request_id` (the idempotency key), added with `ALTER TABLE` and a UNIQUE index. Existing events keep `NULL`.
- No other table changed. `product_batches.current_status` already existed and is now updated by shipments.
- The migration was run on a copy of the local database: the events, batches, users and ledger were all kept and the foreign-key check was clean.

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
| GET | `/api/shipments/batches` | Distributor's list of registered batches for shipment updates |
| POST | `/api/shipments` | Distributor records a shipment update (requires `Idempotency-Key`) |
| GET | `/api/history/<batch ID>` | Batch history: registration, shipment and receipt events in order (any active role) |
| GET | `/api/ledger/verify` | Independent ledger integrity check: Valid or Invalid with details (any active role) |
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
| `SECRET_KEY` | backend | random per start | Signs the demo session cookie (see Security limitations) |
| `SESSION_COOKIE_SECURE` | backend | `0` | Set `1` only when serving over HTTPS |
| `TRACKING_BASE_URL` | backend | `http://localhost:5173` | Base of the tracking URL encoded in QR codes. Use the LAN address to scan from another device |
| `FLASK_HOST` / `FLASK_PORT` | backend | `127.0.0.1` / `5000` | Development server address |
| `FLASK_DEBUG` | backend | `0` | Enables the Flask debugger when `1` |
| `VITE_API_PROXY_TARGET` | frontend | `http://127.0.0.1:5000` | Backend URL used by the Vite proxy |

Never commit real `.env` files, virtual environments, `node_modules`, SQLite database files, build output or Python cache files.

## Known limitations

- Demo role access has no authentication; see [Security limitations](#security-limitations) under Demo role access.
- No business features yet: no user management and no consumer tracking page.
- The ledger is a local, single-application hash chain. See Local ledger for what it does and does not prove.
- SQLite is single-writer; this is acceptable for the local prototype but not for multi-user production load.
