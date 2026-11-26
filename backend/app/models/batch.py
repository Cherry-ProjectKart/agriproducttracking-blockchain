"""Product batch field rules and constants for US-02 (farmer batch registration).

Required fields come from SRS section 7.3: product name, quantity, unit and origin, plus the
harvest/registration date from US-02. The description is optional. The length limits are
implementation defaults chosen for this demo; the SRS does not set them.
"""

from typing import Final

PRODUCT_NAME_MAX_LENGTH: Final[int] = 120
DESCRIPTION_MAX_LENGTH: Final[int] = 500
UNIT_MAX_LENGTH: Final[int] = 20
ORIGIN_MAX_LENGTH: Final[int] = 200

# Status shown after registration. The SRS business rules name this state "Registered".
REGISTERED_STATUS: Final[str] = "Registered"

# Event recorded for each registration (SRS business rules: "Product Registered" event).
REGISTRATION_EVENT_TYPE: Final[str] = "PRODUCT_REGISTERED"
REGISTRATION_EVENT_NOTE: Final[str] = "Product batch registered by farmer."

# Idempotency-Key header: letters, digits and hyphens, 8 to 64 characters (a UUID fits).
IDEMPOTENCY_KEY_PATTERN: Final[str] = r"^[A-Za-z0-9-]{8,64}$"
