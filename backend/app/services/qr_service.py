"""Tracking URLs and QR code images (US-03).

The QR code encodes only the tracking URL, for example http://localhost:5173/track/PB-7K2M-9QXD.
No user, session, key or other private value is included. Images are generated on demand and
never written to disk or to the repository.
"""

import io

import segno

TRACKING_PATH_TEMPLATE = "/track/{batch_id}"
QR_SCALE = 8  # pixels per module
QR_BORDER = 4  # quiet zone in modules (the QR standard recommends 4)


def build_tracking_url(base_url: str, batch_id: str) -> str:
    """The public tracking URL for a batch. base_url is validated at startup (see app/config.py)."""
    return base_url.rstrip("/") + TRACKING_PATH_TEMPLATE.format(batch_id=batch_id)


def render_qr_png(content: str) -> bytes:
    """A PNG image of a QR code (error correction level M). The same input gives identical bytes."""
    buffer = io.BytesIO()
    segno.make(content, error="m").save(buffer, kind="png", scale=QR_SCALE, border=QR_BORDER)
    return buffer.getvalue()
