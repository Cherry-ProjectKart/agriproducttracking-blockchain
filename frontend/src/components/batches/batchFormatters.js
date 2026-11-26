/** "250 kg" for display. Quantities are stored as numbers, so trailing zeros are dropped. */
export function formatQuantity(quantity, unit) {
  return `${Number(quantity)} ${unit}`;
}

/** Local date and time for a backend timestamp, or the raw value if it cannot be parsed. */
export function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
