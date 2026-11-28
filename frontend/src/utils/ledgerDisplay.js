/**
 * Display helpers for the ledger audit view. They only format values that the ledger API already
 * returns; nothing here recalculates or changes a block.
 */

export const EVENT_LABELS = {
  GENESIS: 'Ledger start',
  PRODUCT_REGISTERED: 'Product registered',
  SHIPMENT_UPDATED: 'Shipment updated',
  RECEIPT_CONFIRMED: 'Receipt confirmed',
};

/** Readable names for the fields an event records. Fields not listed here are not shown. */
export const EVENT_DATA_LABELS = {
  batch_id: 'Batch ID',
  actor_role: 'Recorded by',
  status: 'Status',
  note: 'Note',
  event_timestamp: 'Event time',
  product_name: 'Product',
  quantity: 'Quantity',
  unit: 'Unit',
  origin: 'Origin',
  harvest_date: 'Harvest date',
};

/**
 * A long hash in a shorter, readable form such as "20966f2f77cd…f603". The full value is kept by the
 * caller (in a title attribute and for copying). Values too short to shorten are returned unchanged.
 */
export function shortHash(hash, head = 12, tail = 8) {
  if (typeof hash !== 'string' || hash.length <= head + tail + 1) return hash ?? '';
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/**
 * How a block links to the block before it, computed from the blocks already loaded. The stored previous
 * hash is compared with the stored hash of the previous block. The verifier, not this view, recalculates hashes.
 */
export function linkStatement(block, previousBlock) {
  if (block.index === 0) {
    return 'This is the genesis block. It has no earlier block, so its previous hash is 64 zeros.';
  }
  if (!previousBlock) {
    return 'The block before this one is not loaded, so its link cannot be compared here.';
  }
  return block.previous_hash === previousBlock.block_hash
    ? `Its previous hash matches the block hash stored in block ${previousBlock.index}.`
    : `Its previous hash does not match the block hash stored in block ${previousBlock.index}. Run the integrity check to see the details.`;
}
