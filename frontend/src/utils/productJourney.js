/**
 * Builds the consumer's view of a product journey from the events the backend recorded. It reads the
 * persisted events only: nothing is inferred or invented. A milestone is "completed" only when its
 * event exists, and "not yet recorded" otherwise.
 *
 * The milestones follow the existing lifecycle (app/models/shipment.py and app/models/receipt.py):
 * Registered -> Shipped -> In Transit -> Delivered to Retailer -> Received by Retailer.
 */

export const MILESTONE_STATES = Object.freeze({
  COMPLETED: 'completed',
  CURRENT: 'current',
  PENDING: 'pending',
});

const ROLE_LABELS = {
  farmer: 'Farmer',
  distributor: 'Distributor',
  retailer: 'Retailer',
};

/** Capitalised name of the role that recorded an event, for example "Distributor". */
export function roleLabel(role) {
  return ROLE_LABELS[role] ?? (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Unknown');
}

/** The human-readable title of one recorded event, with the role that recorded it. */
export function eventTitle(event) {
  if (event.event_type === 'PRODUCT_REGISTERED') {
    return { title: 'Product registered', role: roleLabel(event.actor_role) };
  }
  if (event.event_type === 'RECEIPT_CONFIRMED') {
    return { title: 'Receipt confirmed', role: roleLabel(event.actor_role) };
  }
  if (event.event_type === 'SHIPMENT_UPDATED') {
    switch (event.status) {
      case 'Shipped':
        return { title: 'Shipment initiated', role: roleLabel(event.actor_role) };
      case 'In Transit':
        return { title: 'In transit', role: roleLabel(event.actor_role) };
      case 'Delivered to Retailer':
        return { title: 'Delivered to retailer', role: roleLabel(event.actor_role) };
      default:
        return { title: `Shipment update: ${event.status}`, role: roleLabel(event.actor_role) };
    }
  }
  return { title: event.label ?? 'Recorded event', role: roleLabel(event.actor_role) };
}

/** The milestones a consumer sees, in order. Each one matches the recorded events it stands for. */
const MILESTONE_DEFINITIONS = [
  { key: 'registered', title: 'Registered', status: 'Registered', matches: (e) => e.event_type === 'PRODUCT_REGISTERED' },
  {
    key: 'shipped',
    title: 'Shipment initiated',
    status: 'Shipped',
    matches: (e) => e.event_type === 'SHIPMENT_UPDATED' && e.status === 'Shipped',
  },
  {
    key: 'in-transit',
    title: 'In transit',
    status: 'In Transit',
    matches: (e) => e.event_type === 'SHIPMENT_UPDATED' && e.status === 'In Transit',
  },
  {
    key: 'delivered',
    title: 'Delivered to retailer',
    status: 'Delivered to Retailer',
    matches: (e) => e.event_type === 'SHIPMENT_UPDATED' && e.status === 'Delivered to Retailer',
  },
  { key: 'received', title: 'Received by retailer', status: 'Received by Retailer', matches: (e) => e.event_type === 'RECEIPT_CONFIRMED' },
];

/** The milestone a batch's current status corresponds to, or null for a status outside the lifecycle. */
function currentMilestoneKey(currentStatus) {
  const found = MILESTONE_DEFINITIONS.find((milestone) => milestone.status === currentStatus);
  return found ? found.key : null;
}

/**
 * The five milestones with their state.
 * - completed: at least one matching event was recorded, and it is not the latest state.
 * - current: the latest state of the batch, and its event was recorded.
 * - pending: no matching event has been recorded.
 * A milestone's events are listed in the order they were recorded.
 */
export function buildMilestones(currentStatus, events) {
  const currentKey = currentMilestoneKey(currentStatus);
  return MILESTONE_DEFINITIONS.map((definition) => {
    const recorded = events.filter(definition.matches);
    const hasEvents = recorded.length > 0;
    let state = MILESTONE_STATES.PENDING;
    if (hasEvents) {
      state = definition.key === currentKey ? MILESTONE_STATES.CURRENT : MILESTONE_STATES.COMPLETED;
    }
    return {
      key: definition.key,
      title: definition.title,
      status: definition.status,
      state,
      events: recorded,
      firstTimestamp: hasEvents ? recorded[0].timestamp : null,
    };
  });
}

/** The latest recorded update time across all events, or null when no event is recorded. */
export function latestUpdate(events) {
  let latest = null;
  for (const event of events) {
    if (event.timestamp && (latest === null || event.timestamp > latest)) latest = event.timestamp;
  }
  return latest;
}

/**
 * The retailer receipt, when it has been confirmed. Returns null before the receipt is recorded.
 * It is built only from the RECEIPT_CONFIRMED event, so the confirming party and time are the recorded ones.
 */
export function receiptSummary(events) {
  const receipt = events.find((event) => event.event_type === 'RECEIPT_CONFIRMED');
  if (!receipt) return null;
  return {
    timestamp: receipt.timestamp,
    confirmedBy: roleLabel(receipt.actor_role),
    status: receipt.status,
    ledgerBlockIndex: receipt.ledger_block_index ?? null,
  };
}
