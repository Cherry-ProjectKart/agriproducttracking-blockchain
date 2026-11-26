"""Distributor shipment statuses and rules (US-05).

Statuses come from the sprint plan (US-05: "Shipped / In Transit / Delivered to Retailer") and
the SRS business rules ("Shipped or In Transit"). They are the only values a Distributor may
submit. "Received by Retailer" belongs to US-06 and is deliberately not included.
"""

from typing import Final

SHIPMENT_STATUSES: Final[tuple[str, ...]] = ("Shipped", "In Transit", "Delivered to Retailer")

SHIPMENT_EVENT_TYPE: Final[str] = "SHIPMENT_UPDATED"
SHIPMENT_ACTOR_ROLE: Final[str] = "distributor"

NOTE_MAX_LENGTH: Final[int] = 300
