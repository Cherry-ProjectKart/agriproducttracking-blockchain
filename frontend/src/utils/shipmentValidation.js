/**
 * Client-side rules for the distributor shipment form (US-05). They mirror
 * backend/app/models/shipment.py and backend/app/services/shipment_service.py; the backend decides.
 */

export const SHIPMENT_STATUSES = Object.freeze(['Shipped', 'In Transit', 'Delivered to Retailer']);

export const NOTE_MAX_LENGTH = 300;

const BATCH_ID_PATTERN = /^PB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
// Any control character, including line breaks and tabs. Notes are a single line of text.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export const EMPTY_SHIPMENT_FORM = Object.freeze({ status: '', note: '' });

/** Returns a map of field name to message. An empty object means the form is valid. */
export function validateShipmentForm({ batchId, status, note }) {
  const errors = {};

  if (!batchId) {
    errors.batchId = 'Select a batch to update.';
  } else if (!BATCH_ID_PATTERN.test(batchId)) {
    errors.batchId = 'Batch ID must look like PB-XXXX-XXXX.';
  }

  if (!status) {
    errors.status = 'Choose a shipment status.';
  } else if (!SHIPMENT_STATUSES.includes(status)) {
    errors.status = `Choose one of: ${SHIPMENT_STATUSES.join(', ')}.`;
  }

  const trimmed = note.trim();
  if (CONTROL_CHARACTERS.test(note)) {
    errors.note = 'Note must be a single line of plain text.';
  } else if (trimmed.length > NOTE_MAX_LENGTH) {
    errors.note = `Note must be ${NOTE_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

/** The JSON body sent to POST /api/shipments. */
export function buildShipmentPayload({ batchId, status, note }) {
  const trimmed = note.trim();
  return {
    batch_id: batchId,
    status,
    note: trimmed || null,
  };
}
