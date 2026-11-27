"""Authorization regression matrix (BPT-102).

Every protected endpoint is exercised for every authenticated role, for an unauthenticated visitor and
for a signed-out browser. The request bodies are deliberately minimal: role checks run before body
validation, so a denied role must get 403 whatever it sends, and an allowed role must get past the
check (anything other than 401/403).
"""

import json
import sqlite3

import pytest

from app.auth import SESSION_KEY
from tests.auth_helpers import DEMO_PASSWORDS, DEMO_USERNAMES, sign_in

ROLES = ("farmer", "distributor", "retailer")
UNKNOWN_BATCH = "PB-ZZZZ-ZZZZ"
KEY = {"Idempotency-Key": "authz-matrix-key-001"}

# (method, path, body, allowed roles). Allowed = {"any"} for every signed-in role.
PROTECTED = [
    ("POST", "/api/batches", {}, {"farmer"}),
    ("GET", "/api/batches", None, {"farmer"}),
    ("GET", "/api/batches/by-batch-id/" + UNKNOWN_BATCH, None, {"farmer"}),
    ("GET", "/api/batches/1", None, {"farmer"}),
    ("GET", "/api/batches/1/qr.png", None, {"farmer"}),
    ("GET", "/api/shipments/batches", None, {"distributor"}),
    ("POST", "/api/shipments", {}, {"distributor"}),
    ("GET", "/api/receipts/awaiting", None, {"retailer"}),
    ("POST", "/api/receipts", {}, {"retailer"}),
    ("GET", "/api/history/" + UNKNOWN_BATCH, None, {"any"}),
    ("GET", "/api/ledger", None, {"any"}),
    ("GET", "/api/ledger/latest", None, {"any"}),
    ("GET", "/api/ledger/verify", None, {"any"}),
    ("GET", "/api/ledger/blocks/0", None, {"any"}),
    ("GET", "/api/role-actions", None, {"any"}),
]

# Public endpoints: no sign-in needed, never 401/403.
PUBLIC = [
    ("GET", "/api/health", None),
    ("GET", "/api/roles", None),
    ("GET", "/api/session", None),
    ("GET", "/api/tracking/" + UNKNOWN_BATCH, None),
]


def _call(client, method, path, body=None, headers=None):
    kwargs = {"headers": dict(headers or {})}
    if body is not None:
        kwargs["json"] = body
    return client.open(path, method=method, **kwargs)


def _allowed(allowed_roles, role):
    return "any" in allowed_roles or role in allowed_roles


# --- Protected endpoints, every role ----------------------------------------


@pytest.mark.parametrize(("method", "path", "body", "allowed"), PROTECTED)
def test_unauthenticated_visitor_is_refused_everywhere(client, method, path, body, allowed):
    response = _call(client, method, path, body, KEY)

    assert response.status_code == 401, (method, path)
    assert response.get_json()["error"]["code"] == 401


@pytest.mark.parametrize(("method", "path", "body", "allowed"), PROTECTED)
@pytest.mark.parametrize("role", ROLES)
def test_each_role_gets_exactly_its_permitted_endpoints(client, method, path, body, allowed, role):
    assert sign_in(client, role).status_code == 200

    response = _call(client, method, path, body, KEY)

    if _allowed(allowed, role):
        assert response.status_code not in (401, 403), (role, method, path, response.status_code)
    else:
        assert response.status_code == 403, (role, method, path, response.status_code)
        assert response.get_json()["error"]["code"] == 403


@pytest.mark.parametrize(("method", "path", "body", "allowed"), PROTECTED)
def test_signed_out_browser_is_refused_everywhere(client, method, path, body, allowed):
    sign_in(client, "farmer")
    assert client.delete("/api/session").status_code == 200

    response = _call(client, method, path, body, KEY)

    assert response.status_code == 401, (method, path)


@pytest.mark.parametrize(("method", "path", "body"), PUBLIC)
def test_public_endpoints_need_no_sign_in(client, method, path, body):
    response = _call(client, method, path, body)

    assert response.status_code not in (401, 403), path


@pytest.mark.parametrize("role", ROLES)
def test_public_tracking_is_read_only_for_every_role(client, role):
    sign_in(client, role)

    for method in ("POST", "PUT", "PATCH", "DELETE"):
        response = _call(client, method, "/api/tracking/" + UNKNOWN_BATCH, {"status": "x"})
        assert response.status_code == 405, method


# --- Forged identity -----------------------------------------------------------


def test_role_in_body_query_or_headers_never_grants_access(client):
    sign_in(client, "farmer")

    shipment = client.post(
        "/api/shipments?role=distributor",
        json={"batch_id": UNKNOWN_BATCH, "status": "Shipped", "role": "distributor"},
        headers={"Idempotency-Key": "forged-role-0001", "X-Role": "distributor", "X-User-Role": "distributor"},
    )
    listing = client.get("/api/shipments/batches?role=distributor", headers={"X-Role": "distributor"})
    receipts = client.get("/api/receipts/awaiting", headers={"X-Role": "retailer"})

    assert shipment.status_code == 403
    assert listing.status_code == 403
    assert receipts.status_code == 403


def test_forged_role_in_registration_body_is_not_trusted_for_sign_in(client):
    response = client.post(
        "/api/session",
        json={"username": DEMO_USERNAMES["farmer"], "password": DEMO_PASSWORDS["farmer"], "role": "retailer"},
    )

    assert response.status_code == 200
    assert response.get_json()["role"] == "farmer"
    assert client.get("/api/receipts/awaiting").status_code == 403


def test_tampered_session_cookie_is_rejected(client):
    sign_in(client, "farmer")
    cookie = client.get_cookie("session")
    payload, signature = cookie.value.rsplit(".", 1)
    # Change the signed payload but keep the old signature.
    forged = payload[:-1] + ("A" if payload[-1] != "A" else "B") + "." + signature
    client.set_cookie("session", forged)

    assert client.get("/api/session").get_json()["active"] is False
    assert client.get("/api/batches").status_code == 401


def test_session_cookie_for_another_account_cannot_be_forged_without_the_secret(app, client):
    # A cookie signed with a different secret must be rejected, even if its payload looks valid.
    from flask.sessions import SecureCookieSessionInterface
    from itsdangerous import URLSafeTimedSerializer

    serializer = URLSafeTimedSerializer(
        "attacker-guessed-secret",
        salt="cookie-session",
        serializer=SecureCookieSessionInterface().serializer,
    )
    forged = serializer.dumps({SESSION_KEY: {"user_id": 1, "issued_at": 1}})
    client.set_cookie("session", forged)

    assert client.get("/api/session").get_json()["active"] is False
    assert client.get("/api/batches").status_code == 401


# --- Ownership -------------------------------------------------------------------


def _register_farmer(client, username):
    client.delete("/api/session")
    response = client.post(
        "/api/accounts",
        json={
            "full_name": "Other Farmer",
            "username": username,
            "password": "OtherFarmer2026",
            "confirm_password": "OtherFarmer2026",
            "role": "farmer",
        },
    )
    assert response.status_code == 201
    client.delete("/api/session")


def _batch_of_demo_farmer(client):
    sign_in(client, "farmer")
    response = client.post(
        "/api/batches",
        json={
            "product_name": "Maize",
            "quantity": 10,
            "unit": "kg",
            "origin": "Hill Farm",
            "harvest_date": "2026-10-01",
        },
        headers={"Idempotency-Key": "owner-batch-0001"},
    )
    assert response.status_code == 201
    batch = response.get_json()["batch"]
    client.delete("/api/session")
    return batch


def test_another_farmer_cannot_read_or_generate_a_batch_they_do_not_own(client):
    batch = _batch_of_demo_farmer(client)
    _register_farmer(client, "other.farmer")
    client.post("/api/session", json={"username": "other.farmer", "password": "OtherFarmer2026"})

    assert client.get("/api/batches").get_json()["batches"] == []
    assert client.get(f"/api/batches/{batch['id']}").status_code == 404
    assert client.get(f"/api/batches/by-batch-id/{batch['batch_id']}").status_code == 404
    assert client.get(f"/api/batches/{batch['id']}/qr.png").status_code == 404


def test_owner_can_read_their_batch(client):
    batch = _batch_of_demo_farmer(client)
    sign_in(client, "farmer")

    assert client.get(f"/api/batches/{batch['id']}").status_code == 200
    assert client.get(f"/api/batches/{batch['id']}/qr.png").status_code == 200


def test_other_roles_cannot_see_farmer_identity_in_batch_data(client):
    _batch_of_demo_farmer(client)

    for role in ("distributor", "retailer"):
        sign_in(client, role)
        bodies = []
        if role == "distributor":
            bodies.append(client.get("/api/shipments/batches").get_data(as_text=True))
        else:
            bodies.append(client.get("/api/receipts/awaiting").get_data(as_text=True))
        for text in bodies:
            assert "demo.farmer" not in text
            assert "Demo Farmer" not in text


# --- Sign-out and account state -------------------------------------------------


def test_sign_out_revokes_access_to_every_protected_endpoint(client):
    sign_in(client, "retailer")
    assert client.get("/api/receipts/awaiting").status_code == 200

    client.delete("/api/session")

    for method, path, body, _allowed_roles in PROTECTED:
        assert _call(client, method, path, body, KEY).status_code == 401, path


def test_disabled_account_loses_access_mid_session(client, db_path):
    sign_in(client, "distributor")
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE users SET status = 'disabled' WHERE username = 'demo.distributor'")
    conn.commit()
    conn.close()

    assert client.get("/api/shipments/batches").status_code == 401
    assert client.get("/api/session").get_json()["active"] is False


def test_role_change_in_database_takes_effect_on_the_next_request(client, db_path):
    sign_in(client, "farmer")
    assert client.get("/api/batches").status_code == 200

    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE users SET role = 'retailer' WHERE username = 'demo.farmer'")
    conn.commit()
    conn.close()

    assert client.get("/api/batches").status_code == 403
    assert client.get("/api/receipts/awaiting").status_code == 200


def test_forbidden_response_shape_is_consistent(client):
    sign_in(client, "farmer")

    response = client.get("/api/receipts/awaiting")

    body = json.loads(response.get_data(as_text=True))
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "name", "message"}
    assert body["error"]["name"] == "Forbidden"
