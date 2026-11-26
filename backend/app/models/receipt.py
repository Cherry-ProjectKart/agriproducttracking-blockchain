"""Retailer receipt confirmation rules (US-06).

A batch is awaiting receipt when a distributor has set its status to "Delivered to Retailer"
(see app/models/shipment.py). Confirming receipt moves it to "Received by Retailer" and records a
RECEIPT_CONFIRMED event whose actor is the retailer. No other transition is allowed.
"""

from typing import Final

AWAITING_RECEIPT_STATUS: Final[str] = "Delivered to Retailer"
RECEIVED_STATUS: Final[str] = "Received by Retailer"

RECEIPT_EVENT_TYPE: Final[str] = "RECEIPT_CONFIRMED"
RECEIPT_ACTOR_ROLE: Final[str] = "retailer"
