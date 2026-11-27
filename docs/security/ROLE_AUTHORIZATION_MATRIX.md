# Role authorization matrix (BPT-102)

This document describes the access policy that the code enforces, and where the implementation differs from the policy as first written. The backend is the authority: every rule below is enforced on the server. Frontend routes and navigation only keep the browser consistent with the server's decisions.

Covered by `backend/tests/test_authorization_matrix.py` (93 cases) and `frontend/src/App.guards.test.jsx`.

## 1. Roles and identity

| Role | Source of identity | Notes |
|---|---|---|
| Farmer | Signed-in account with `role = farmer` | Registers and owns batches |
| Distributor | Signed-in account with `role = distributor` | Records shipment updates |
| Retailer | Signed-in account with `role = retailer` | Confirms receipt |
| Consumer | None | Public, read-only tracking only; no account |

Identity comes only from the signed session cookie (`app/auth.py`). The cookie holds the account id and the time it was issued. On every request the account is reloaded from the database, and the role is taken from that record. A missing, disabled, unsupported-role or expired account is treated as signed out.

A role supplied in a request body, query string, or header is ignored. Tests send `role` in the body, `?role=` in the query and `X-Role` headers and still get 403.

## 2. Authorization matrix

| Functionality | Farmer | Distributor | Retailer | Consumer | Enforced by |
|---|---|---|---|---|---|
| Farmer workspace (`/farmer`) | Allow | Deny | Deny | Deny | Frontend route guard; API below |
| Register product batch (`POST /api/batches`) | Allow | Deny | Deny | Deny | `require_role("farmer")` |
| List own batches (`GET /api/batches`) | Allow | Deny | Deny | Deny | `require_role("farmer")`, filtered to owner |
| View own batch (`GET /api/batches/<id>`, `/by-batch-id/<code>`) | Allow | Deny | Deny | Deny | `require_role("farmer")` and owner check |
| Generate own batch QR (`GET /api/batches/<id>/qr.png`) | Allow | Deny | Deny | Deny | `require_role("farmer")` and owner check |
| Distributor workspace (`/distributor`) | Deny | Allow | Deny | Deny | Frontend route guard; API below |
| View shipment batches (`GET /api/shipments/batches`) | Deny | Allow | Deny | Deny | `require_role("distributor")` |
| Update shipment status (`POST /api/shipments`) | Deny | Allow | Deny | Deny | `require_role("distributor")` |
| Retailer workspace (`/retailer`) | Deny | Deny | Allow | Deny | Frontend route guard; API below |
| View awaiting receipts (`GET /api/receipts/awaiting`) | Deny | Deny | Allow | Deny | `require_role("retailer")` |
| Confirm receipt (`POST /api/receipts`) | Deny | Deny | Allow | Deny | `require_role("retailer")` |
| Batch history (`GET /api/history/<batch ID>`) | Allow | Allow | Allow | Deny | `require_role(*all roles)` |
| Ledger read and verify (`GET /api/ledger*`) | Allow | Allow | Allow | Deny | `require_role(*all roles)` |
| Role actions (`GET /api/role-actions`) | Allow | Allow | Allow | Deny | `require_role(*all roles)` |
| Public QR tracking (`GET /api/tracking/<batch ID>`) | Allow | Allow | Allow | Allow | No guard; whitelisted fields |
| Public tracking modification (POST/PUT/PATCH/DELETE on `/api/tracking`) | Deny | Deny | Deny | Deny | Route accepts GET only (405) |

"Allow" for history, ledger and role actions also covers the three signed-in roles, as the existing BPT-005 and BPT-008 decisions require. Consumers have no account, so they never reach these endpoints.

## 3. Protected frontend routes

| Address | Who may see it | Behaviour for everyone else |
|---|---|---|
| `/farmer` | Signed-in farmer | Signed-out: moved to `/sign-in`. Other role: moved to their own workspace address |
| `/distributor` | Signed-in distributor | As above |
| `/retailer` | Signed-in retailer | As above |
| `/` | Any | Signed-in: moved to own workspace. Signed-out: sign-in page |
| `/sign-in`, `/register` | Signed-out visitors | Signed-in users are moved to their own workspace |
| `/track/<batch ID>` | Anyone | Public. Never requires a session |

While the session is loading, no workspace content is rendered. The workspace component is only ever rendered for the signed-in role, so a different role's panels are never mounted, even briefly. Sign-out replaces the address with `/sign-in`. Using browser Back to return to a workspace address after sign-out shows the sign-in page.

Frontend guards do not replace backend checks. A user who edits frontend state gets the server's answer for every request they make.

## 4. Role navigation

Each workspace lists only its own sections, as in-page links (`frontend/src/utils/roleNavigation.js`):

| Role | Links |
|---|---|
| Farmer | Dashboard, Product batches and registration, Batch history, Ledger |
| Distributor | Dashboard, Eligible batches and shipment updates, Batch history, Ledger |
| Retailer | Dashboard, Awaiting receipts and confirmation, Batch history, Ledger |
| Consumer | None (public tracking page only) |

## 5. Protected API endpoints

| Method | Path | Allowed roles | Response when refused |
|---|---|---|---|
| POST | `/api/batches` | farmer | 401 no session; 403 other role |
| GET | `/api/batches` | farmer | 401 / 403 |
| GET | `/api/batches/by-batch-id/<code>` | farmer (owner) | 401 / 403; 404 when not the owner's batch |
| GET | `/api/batches/<id>` | farmer (owner) | 401 / 403; 404 when not the owner's batch |
| GET | `/api/batches/<id>/qr.png` | farmer (owner) | 401 / 403; 404 when not the owner's batch |
| GET | `/api/shipments/batches` | distributor | 401 / 403 |
| POST | `/api/shipments` | distributor | 401 / 403 |
| GET | `/api/receipts/awaiting` | retailer | 401 / 403 |
| POST | `/api/receipts` | retailer | 401 / 403 |
| GET | `/api/history/<batch ID>` | any signed-in role | 401 |
| GET | `/api/ledger`, `/api/ledger/latest`, `/api/ledger/verify`, `/api/ledger/blocks/<index>` | any signed-in role | 401 |
| GET | `/api/role-actions` | any signed-in role | 401 |
| DELETE | `/api/session` | none (idempotent sign-out) | 200 always |

## 6. Public endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | Application and database status |
| GET | `/api/roles` | The three operational roles and descriptions |
| GET | `/api/session` | `active: false` when signed out; account summary when signed in |
| POST | `/api/session` | Sign-in (credentials only; role is never taken from the request) |
| POST | `/api/accounts` | Registration (role is validated against the three operational roles) |
| GET | `/api/tracking/<batch ID>` | Whitelisted batch and event fields only. No user, username, row IDs, hashes of users, or request keys |

## 7. Ownership rules

- **Farmer batches:** a farmer sees and acts only on batches whose `created_by` is their own account. Other farmers' batches return 404, not 403, so their existence is not disclosed.
- **Shipments and receipts:** the distributor and retailer roles act on any batch in the system, as the business rules require. Neither role can see the farmer's identity in these responses.
- **Ledger and history:** shared read-only record for all signed-in roles. They contain no user names.
- **Accounts:** a user can see only their own account summary through `/api/session`.

## 8. Error response behaviour

All API errors use one shape:

```json
{ "error": { "code": 403, "name": "Forbidden", "message": "..." } }
```

- **401 Unauthorized:** no valid session, expired session, forged or tampered cookie, deleted or disabled account, or an unsupported role on the account. Message: "Sign in to continue."
- **403 Forbidden:** signed in, but the account's role is not allowed for this endpoint. Message: "Your account's role is not permitted to perform this action."
- **404 Not Found:** the batch does not exist, or it belongs to another farmer.
- **405 Method Not Allowed:** a write method on the public tracking endpoint.

Role checks run before body validation, so a refused role gets 403 whatever it sends.

## 9. Known limitations and differences from the policy as written

1. **Shipment batch list.** The matrix says "View eligible shipment batches". The endpoint returns every registered batch, without filtering by status. The distributor can therefore see batches that are not yet shippable. This is the behaviour from BPT-006 and is unchanged.
2. **Shipment status transitions.** The matrix does not cover them. A distributor can record any of the three statuses in any order (BPT-006 has no transition rules). Tracked separately.
3. **Receipt list.** `/api/receipts/awaiting` lists every batch with status `Delivered to Retailer`, for any retailer. Ownership does not apply to retailers in the business rules.
4. **Ledger and history for signed-in roles.** The matrix does not list them. They are open to all three signed-in roles, as BPT-005 and BPT-008 specify.
5. **Frontend tests are not browser E2E.** `App.guards.test.jsx` runs the real application shell with mocked API services. The authorization matrix tests run the real Flask app through its test client. Neither is a browser end-to-end test. Browser behaviour was checked manually during BPT-101; there is no automated browser test suite in the repository.
6. **No rate limit or CSRF token** on sign-in and state-changing endpoints (carried over from BPT-101).
7. **Sessions** are cookie-based. Setting `SECRET_KEY` keeps sessions valid across backend restarts; otherwise they end on restart.
