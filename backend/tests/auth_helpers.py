"""Sign-in helpers for tests. The demo passwords are set by the autouse fixture in conftest.py."""

DEMO_USERNAMES = {
    "farmer": "demo.farmer",
    "distributor": "demo.distributor",
    "retailer": "demo.retailer",
}

DEMO_PASSWORDS = {
    "farmer": "FarmerDemo2026",
    "distributor": "DistributorDemo2026",
    "retailer": "RetailerDemo2026",
}

DEMO_ENV = {
    "farmer": "DEMO_FARMER_PASSWORD",
    "distributor": "DEMO_DISTRIBUTOR_PASSWORD",
    "retailer": "DEMO_RETAILER_PASSWORD",
}


def sign_in(client, role):
    """Sign in as the demo account for a role. Returns the response (200 on success)."""
    return client.post(
        "/api/session",
        json={"username": DEMO_USERNAMES[role], "password": DEMO_PASSWORDS[role]},
    )
