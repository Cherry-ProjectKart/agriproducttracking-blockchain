# College demonstration guide

This guide shows the complete product journey in about 5–8 minutes: a farmer registers a product, a distributor moves it, a retailer receives it, a consumer reads its journey from the QR code, and the ledger is checked. Every name and command below comes from the repository. The sample product is fictional.

## Project overview

The **Blockchain-Enabled Product Tracking System** traces an agricultural batch from farm to retailer. Each recorded step is written to a **local, centralised, SHA-256 hash-linked ledger** stored in the SQLite database. The ledger is **not a public or decentralised blockchain**: there are no peers, no consensus and no tokens. Hash verification detects changes to recorded data; it does not prove that product information was true.

Roles:

| Role | What it does |
|---|---|
| Farmer | Registers a batch, edits its description, shows its QR code, copies its tracking link |
| Distributor | Sees registered batches and moves them through the shipment lifecycle |
| Retailer | Sees batches delivered to it and confirms receipt |
| Consumer | Opens the public tracking page from the QR code. No account, read-only |

## Technology stack

- **Frontend:** React 19 with Vite 7 (`frontend/`)
- **Backend:** Python with Flask 3.1 (`backend/`)
- **Database:** SQLite (`backend/instance/product_tracking.db`)
- **QR codes:** `segno` (PNG)
- **Ledger:** SHA-256 over canonical JSON, stored in the `ledger_blocks` table
- **Tests:** pytest (backend), Vitest with Testing Library (frontend)

## Prerequisites

- Python 3.11 or newer (developed with 3.13)
- Node.js 20.19 or newer, with npm 10 or newer (developed with Node 20.20)
- Git
- A web browser

## Environment configuration

1. Copy the backend settings file and open it:

   ```powershell
   cd backend
   Copy-Item .env.example .env
   ```

2. In `backend/.env`, set the three demo passwords. Each must be at least 8 characters and contain a letter and a number:

   ```
   DEMO_FARMER_PASSWORD=<your farmer password>
   DEMO_DISTRIBUTOR_PASSWORD=<your distributor password>
   DEMO_RETAILER_PASSWORD=<your retailer password>
   ```

   Choose your own values. Do not commit `backend/.env`; the repository ignores it.

3. Optional, for a phone on the same Wi-Fi network: set `TRACKING_BASE_URL` to this computer's LAN address, for example `http://192.168.1.20:5173`. The default `http://localhost:5173` works for the demonstration on one computer.

4. Optional: set `SECRET_KEY` to a long random string. If it is empty, a new key is generated on each backend start, so **every sign-in ends when the backend restarts**. For a demonstration that runs across restarts, set it.

## Setup

Backend (PowerShell, from the repository root):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Initialise the database (from `backend/`, with the virtual environment active):

```powershell
python scripts/init_db.py
```

This creates `instance/product_tracking.db` if it is missing, the four tables, the three demo accounts and their passwords, and the ledger's genesis block. It is safe to run again: existing data is kept, and a demo password that is already stored is not changed.

Frontend (from the repository root):

```powershell
cd frontend
npm install
```

## Starting the application

Terminal 1, from `backend/` with the virtual environment active:

```powershell
python run.py
```

Terminal 2, from `frontend/`:

```powershell
npm run dev
```

Open <http://localhost:5173>. The landing page lists the three roles and shows the backend and database status. Check the health endpoint if needed: `http://127.0.0.1:5000/api/health` returns `"status": "ok"` when the database is ready.

## Demo accounts

| Role | Username | Password |
|---|---|---|
| Farmer | `demo.farmer` | the value you set in `DEMO_FARMER_PASSWORD` |
| Distributor | `demo.distributor` | the value you set in `DEMO_DISTRIBUTOR_PASSWORD` |
| Retailer | `demo.retailer` | the value you set in `DEMO_RETAILER_PASSWORD` |

Passwords are never written into the source code, the API or the screens. They are stored as hashes. To change a demo password, clear its stored hash and run `init_db.py` again:

```sql
UPDATE users SET password_hash = NULL WHERE username = 'demo.farmer';
```

Participants may also create their own accounts with **Create an account** on the sign-in page. They choose a role when they register.

## Demonstration flow

Each stage lists what to do and what you should see.

### 1. Farmer registers a sample batch (about 1 minute)

1. Sign in as `demo.farmer`. The **Farmer workspace** opens.
2. In **Register a product batch**, enter a fictional product, for example:
   - Product name: `Demo Mangoes (sample)`
   - Origin: `Demo Orchard, Sample District`
   - Quantity: `100`, unit: `crates`
   - Harvest date: any past date
   - Description: `Fictional sample batch for the demonstration.`
3. Select **Register batch**. **Expected:** a confirmation with a new batch ID such as `PB-XXXX-XXXX`, and the batch appears in **Your registered batches**.
4. Select **View QR** on the batch. **Expected:** the QR image, the line *Scanning opens the tracking page*, and the tracking link.
5. Select **Download QR code (PNG)**. **Expected:** a message *Download started* and a PNG named after the batch ID and product.
6. Select **Copy tracking link**. **Expected:** *Tracking link copied.*
7. Optional: select **History** on the batch. **Expected:** one *Registration* event.

### 2. Distributor moves the batch (about 2 minutes)

1. Select **Sign out** in the header, then sign in as `demo.distributor`.
2. The **Distributor workspace** lists the registered batches with their status and **next movement**. **Expected:** your new batch shows *Registered* and next movement *Shipped*.
3. Select the batch's radio button. **Expected:** the **Shipment details** card, the **Movement history**, and the form, with the status fixed to the next movement only.
4. Select **Save shipment update**, then **Confirm and record**. **Expected:** *Shipment saved.* with a ledger block number and block hash. The batch is now *Shipped*.
5. Repeat for **In Transit**, then **Delivered to Retailer**. **Expected:** each movement adds a shipment event, and the next movement changes.
6. Optional: try to record **Shipped** again. **Expected:** the server refuses it because the batch has already moved on; nothing is written.

### 3. Retailer confirms receipt (about 1 minute)

1. Sign out, then sign in as `demo.retailer`.
2. **Incoming shipments awaiting receipt** lists the delivered batch with its delivery time. Select it. **Expected:** **Batch details** and the movement history.
3. Select **Confirm receipt**, then **Confirm handover**. **Expected:** *Receipt confirmed.* with the receipt time, the ledger block and its hash. The batch leaves the awaiting list and appears in **Received batches**.
4. Optional: try to confirm the same batch again. **Expected:** the server refuses it; it can only be received once.

### 4. Consumer scans the QR code (about 1 minute)

1. Sign out. Do not sign in again for this step.
2. Open the tracking link copied in step 1 (`http://localhost:5173/track/<batch ID>`), or scan the QR code with a phone on the same network if `TRACKING_BASE_URL` is set for it.
3. **Expected:** the **Product overview** (product, description, quantity, origin, harvest date, status, latest update), **Where the product stands** with each step marked *Completed*, *Current* or *Not yet recorded*, the **Retailer receipt and handover** section, and the **Journey** timeline in order. The page has no buttons or forms.
4. Open `http://localhost:5173/track/PB-ZZZZ-ZZZZ`. **Expected:** *We could not find this batch.* Open `http://localhost:5173/track/not-a-code`. **Expected:** *This is not a valid batch code.*

### 5. Ledger inspection and verification (about 2 minutes)

1. Sign in as any demonstration account, for example `demo.farmer`. Open the workspace's **Ledger** section.
2. **Ledger overview:** blocks in the chain, latest block and time, recorded events, the genesis block, and *Not checked yet*.
3. Select **Details** on your batch's receipt block. **Expected:** the event, the batch, the recording role, both hashes in full, and *Its previous hash matches the block hash stored in block N−1.*
4. Select **Copy** next to a hash. **Expected:** *Copied.*
5. Select **Verify ledger**. **Expected:** *Valid. All N blocks passed every check. No integrity failures were found.* The overview shows *Valid* and 0 failures. Nothing is changed by this check.

## What to say about the blockchain

- Every recorded step (registration, each shipment movement, the receipt) is one **event** in the database and one **block** in a chain.
- A block stores its event as **canonical JSON** (sorted keys, no spaces), its **index**, its **timestamp**, and the **hash of the block before it**.
- Its own **SHA-256 hash** is calculated over those fields. Changing any stored block would change its hash, so the next block's stored link would no longer match.
- The first block, the **genesis block** (block 0), has no earlier block and a fixed timestamp.
- The event and its block are written in **one transaction**. If either fails, both are rolled back.
- **Verify ledger** recalculates every hash from the stored data and checks each link. It changes nothing.
- Be clear about the limit: this is one database on one computer. Someone with access to the file could rebuild a consistent chain. The ledger shows that recorded data has not changed since it was written; it does not prove the product information was true.

## Expected results at a glance

| Stage | Result |
|---|---|
| Farmer registers | new batch ID, QR image, tracking link |
| Distributor moves | status and next movement change; one block per movement |
| Retailer confirms | status *Received by Retailer*; one receipt block |
| Consumer opens link | full journey, no sign-in, no controls |
| Ledger verify | *Valid*, block count matches the number of recorded events plus one (genesis) |

## Troubleshooting

- **Sign-in fails with "Username or password is incorrect.":** check the username (`demo.farmer`, lower case) and the password in `backend/.env`. Run `init_db.py` once after setting a new password, and remember the password is only changed when its stored hash is empty.
- **Health shows `503` or "degraded":** the database is missing or not initialised. Run `python scripts/init_db.py` from `backend/`.
- **Signed out after a backend restart:** `SECRET_KEY` is empty, so a new key is created on each start. Set `SECRET_KEY` in `backend/.env`.
- **The QR image does not load:** the backend is not running, or the browser cannot reach `/api`. Start `python run.py` and reload.
- **The tracking page says the record cannot be reached:** the frontend is not running on the address in `TRACKING_BASE_URL`, or the phone cannot reach this computer. Use the LAN address and start the frontend with `npm run dev -- --host`.
- **Port 5173 or 5000 is in use:** stop the program using it, or change `FLASK_PORT` in `backend/.env`.
- **A test batch shows an unusual description or quantity:** the database may contain records from development. They are real records and are kept; register a new sample batch for the demonstration instead.

## Known limitations

- The ledger is centralised and local (see above). It is not a public or decentralised blockchain.
- Shipments record a status and a note only; the application does not record a location or a carrier.
- A receipt records that a retailer confirmed delivery; it does not record the condition of the goods.
- Any retailer can confirm any delivered batch, and any distributor can move any batch. The records show the role, not the individual person.
- Verification is designed for a demonstration. The block list loads all blocks at once.
- The application has no HTTPS, rate limiting or CSRF token. It is for localhost and a trusted network only.
- The browser checks behind this guide were made on desktop and phone-width layouts. Verify the layout on your own screen before presenting.
