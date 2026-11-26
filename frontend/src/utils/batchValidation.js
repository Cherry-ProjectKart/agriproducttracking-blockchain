/**
 * Client-side rules for the farmer batch form (US-02). They mirror the backend rules in
 * backend/app/services/batch_service.py, which remains the authority.
 */

export const BATCH_LIMITS = Object.freeze({
  productName: 120,
  description: 500,
  unit: 20,
  origin: 200,
});

export const EMPTY_BATCH_FORM = Object.freeze({
  productName: '',
  description: '',
  quantity: '',
  unit: '',
  origin: '',
  harvestDate: '',
});

// Plain decimal numbers only: "12" or "12.5". Rejects signs, exponents and empty input.
const NUMBER_PATTERN = /^[0-9]+(\.[0-9]+)?$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function isRealCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requiredText(value, label, maxLength) {
  const text = value.trim();
  if (!text) return `${label} is required.`;
  if (text.length > maxLength) return `${label} must be ${maxLength} characters or fewer.`;
  return null;
}

/** Returns an object mapping field names to messages. An empty object means the form is valid. */
export function validateBatchForm(values) {
  const errors = {};

  const productName = requiredText(values.productName, 'Product name', BATCH_LIMITS.productName);
  if (productName) errors.productName = productName;

  const description = values.description.trim();
  if (description.length > BATCH_LIMITS.description) {
    errors.description = `Description must be ${BATCH_LIMITS.description} characters or fewer.`;
  }

  const quantity = values.quantity.trim();
  if (!quantity) {
    errors.quantity = 'Quantity is required.';
  } else if (!NUMBER_PATTERN.test(quantity)) {
    errors.quantity = 'Quantity must be a positive number, for example 25 or 12.5.';
  } else if (Number(quantity) <= 0) {
    errors.quantity = 'Quantity must be greater than zero.';
  }

  const unit = requiredText(values.unit, 'Unit', BATCH_LIMITS.unit);
  if (unit) errors.unit = unit;

  const origin = requiredText(values.origin, 'Origin or farm location', BATCH_LIMITS.origin);
  if (origin) errors.origin = origin;

  const harvestDate = values.harvestDate.trim();
  if (!harvestDate) {
    errors.harvestDate = 'Harvest or registration date is required.';
  } else if (!DATE_PATTERN.test(harvestDate)) {
    errors.harvestDate = 'Date must use the format YYYY-MM-DD.';
  } else if (!isRealCalendarDate(harvestDate)) {
    errors.harvestDate = 'Enter a valid calendar date.';
  }

  return errors;
}

/** Builds the JSON body sent to POST /api/batches from validated form values. */
export function buildBatchPayload(values) {
  const description = values.description.trim();
  return {
    product_name: values.productName.trim(),
    description: description || null,
    quantity: Number(values.quantity.trim()),
    unit: values.unit.trim(),
    origin: values.origin.trim(),
    harvest_date: values.harvestDate.trim(),
  };
}
