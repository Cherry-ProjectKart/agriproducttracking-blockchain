"""Supported demonstration roles, their labels, sample accounts and role-specific actions.

These are fixed application constants. Only roles listed in SUPPORTED_ROLES may be
selected or used for role checks. Sample accounts are seeded into the existing
`users` table by app/db.py during initialisation; no passwords are involved.
"""

from typing import Final

SUPPORTED_ROLES: Final[tuple[str, ...]] = ("farmer", "distributor", "retailer")

ROLE_LABELS: Final[dict[str, str]] = {
    "farmer": "Farmer",
    "distributor": "Distributor",
    "retailer": "Retailer",
}

ROLE_DESCRIPTIONS: Final[dict[str, str]] = {
    "farmer": "Register agricultural product batches and review the batches you have registered.",
    "distributor": "View registered batches and record shipment or movement updates.",
    "retailer": "View incoming batches and confirm receipt of products.",
}

# role -> (username, display_name) of the sample account seeded for that role.
DEMO_ACCOUNTS: Final[dict[str, tuple[str, str]]] = {
    "farmer": ("demo.farmer", "Demo Farmer"),
    "distributor": ("demo.distributor", "Demo Distributor"),
    "retailer": ("demo.retailer", "Demo Retailer"),
}

# role -> (action key, action label, available). Actions marked unavailable are placeholders
# until their stories are built. Register batch is available from BPT-003 (US-02).
ROLE_ACTIONS: Final[dict[str, tuple[tuple[str, str, bool], ...]]] = {
    "farmer": (("register_batch", "Register product batch", True),),
    "distributor": (("record_shipment", "Record shipment update", False),),
    "retailer": (("confirm_receipt", "Confirm receipt of batch", False),),
}
