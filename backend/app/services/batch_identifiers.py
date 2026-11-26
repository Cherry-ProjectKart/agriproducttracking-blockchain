"""Unique, human-readable batch IDs (US-03).

Format: PB-XXXX-XXXX, where each X is one of the 32 Crockford base32 characters
(0-9 and A-Z without I, L, O and U). Example: PB-7K2M-9QXD.

IDs are random (from the `secrets` module), so they are not guessable from registration
order. Uniqueness is enforced by the UNIQUE constraint on product_batches.batch_code. A
collision is retried with a new ID, so the code does not rely on the random space being
large enough to avoid one.
"""

import re
import secrets
import sqlite3
from typing import Final

BATCH_ID_PREFIX: Final[str] = "PB"
_ALPHABET: Final[str] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_GROUP_LENGTH: Final[int] = 4
_GROUPS: Final[int] = 2
MAX_ID_ATTEMPTS: Final[int] = 10

BATCH_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^PB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")


class BatchIdAllocationError(RuntimeError):
    """Raised when no unique ID could be allocated after MAX_ID_ATTEMPTS tries."""


def generate_batch_id() -> str:
    """A new random candidate ID. Uniqueness is checked by the database, not here."""
    characters = "".join(secrets.choice(_ALPHABET) for _ in range(_GROUP_LENGTH * _GROUPS))
    groups = [characters[i : i + _GROUP_LENGTH] for i in range(0, len(characters), _GROUP_LENGTH)]
    return "-".join([BATCH_ID_PREFIX, *groups])


def is_valid_batch_id(value: object) -> bool:
    return isinstance(value, str) and BATCH_ID_PATTERN.match(value) is not None


def is_unique_violation(error: sqlite3.IntegrityError) -> bool:
    return "UNIQUE constraint failed: product_batches.batch_code" in str(error)


def assign_batch_id(conn: sqlite3.Connection, batch_row_id: int) -> str:
    """Give an existing batch that has no ID a new unique ID, and return it.

    Does not commit; the caller controls the transaction.
    """
    for _ in range(MAX_ID_ATTEMPTS):
        candidate = generate_batch_id()
        try:
            conn.execute(
                "UPDATE product_batches SET batch_code = ? WHERE id = ? AND batch_code IS NULL",
                (candidate, batch_row_id),
            )
            return candidate
        except sqlite3.IntegrityError as error:
            if not is_unique_violation(error):
                raise
    raise BatchIdAllocationError("Could not allocate a unique batch ID.")
