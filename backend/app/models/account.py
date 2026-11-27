"""Account rules for registration and sign-in (BPT-101).

These constants are the single source for the server-side rules. The frontend mirrors them in
frontend/src/utils/accountValidation.js; the server never relies on that mirror.
"""

import re
from typing import Final

USERNAME_MIN_LENGTH: Final[int] = 3
USERNAME_MAX_LENGTH: Final[int] = 32
# Lower-case letters, digits, dot, underscore and hyphen. Must start with a letter or digit.
USERNAME_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")

FULL_NAME_MIN_LENGTH: Final[int] = 2
FULL_NAME_MAX_LENGTH: Final[int] = 80

PASSWORD_MIN_LENGTH: Final[int] = 8
PASSWORD_MAX_LENGTH: Final[int] = 128

ACCOUNT_STATUS_ACTIVE: Final[str] = "active"
ACCOUNT_STATUS_DISABLED: Final[str] = "disabled"

# Environment variables holding the demo account passwords. Read at database initialisation only.
DEMO_PASSWORD_ENV: Final[dict[str, str]] = {
    "farmer": "DEMO_FARMER_PASSWORD",
    "distributor": "DEMO_DISTRIBUTOR_PASSWORD",
    "retailer": "DEMO_RETAILER_PASSWORD",
}

# Display density for data grids (BPT-104). Stored per account in users.grid_density.
GRID_DENSITY_VALUES: Final[tuple[str, ...]] = ("comfortable", "compact")
DEFAULT_GRID_DENSITY: Final[str] = "comfortable"
