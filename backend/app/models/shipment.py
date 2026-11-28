"""Distributor shipment statuses and movement lifecycle (US-05, BPT-107).

Statuses come from the sprint plan (US-05: "Shipped / In Transit / Delivered to Retailer") and
the SRS business rules ("Shipped or In Transit"). They are the only values a Distributor may
submit. "Received by Retailer" belongs to US-06 and is deliberately not included.

The lifecycle is a single ordered sequence. A batch moves one step at a time:

    Registered -> Shipped -> In Transit -> Delivered to Retailer

"Delivered to Retailer" is the last distributor step. The retailer then confirms receipt (US-06).
A batch cannot skip a step, go backwards, or repeat a status. Every shipment record is still kept,
so the full movement history stays visible in order.
"""

from typing import Final

from app.models.batch import REGISTERED_STATUS

SHIPMENT_STATUSES: Final[tuple[str, ...]] = ("Shipped", "In Transit", "Delivered to Retailer")

# Schema default for product_batches.current_status in rows written before the registration status
# was set explicitly. Such a batch is treated as registered so that it can still be shipped.
LEGACY_REGISTERED_STATUS: Final[str] = "CREATED"

# The next status a batch may move to, given its current status. A status that is not listed here
# (for example a legacy or unknown value) has no next movement: its history stays readable, but a
# Distributor cannot record a new movement for it.
SHIPMENT_TRANSITIONS: Final[dict[str, tuple[str, ...]]] = {
    REGISTERED_STATUS: ("Shipped",),
    LEGACY_REGISTERED_STATUS: ("Shipped",),
    "Shipped": ("In Transit",),
    "In Transit": ("Delivered to Retailer",),
}


def next_shipment_statuses(current_status: str) -> tuple[str, ...]:
    """The statuses a Distributor may record next for a batch in current_status. Empty when none."""
    return SHIPMENT_TRANSITIONS.get(current_status, ())


SHIPMENT_EVENT_TYPE: Final[str] = "SHIPMENT_UPDATED"
SHIPMENT_ACTOR_ROLE: Final[str] = "distributor"

NOTE_MAX_LENGTH: Final[int] = 300
