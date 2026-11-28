// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import ConsumerTrackingPage from './ConsumerTrackingPage.jsx';
import * as trackingService from '../services/trackingService.js';
import { buildMilestones, eventTitle, latestUpdate, receiptSummary } from '../utils/productJourney.js';

vi.mock('../services/trackingService.js', () => ({
  fetchPublicTracking: vi.fn(),
}));

const BATCH_ID = 'PB-7K2M-9QXD';

const REGISTERED = {
  event_type: 'PRODUCT_REGISTERED',
  label: 'Registration',
  actor_role: 'farmer',
  status: 'Registered',
  note: null,
  timestamp: '2026-11-26T10:00:00.000Z',
  ledger_block_index: 1,
};
const SHIPPED = {
  event_type: 'SHIPMENT_UPDATED',
  label: 'Shipment',
  actor_role: 'distributor',
  status: 'Shipped',
  note: 'Left the farm',
  timestamp: '2026-11-27T08:00:00.000Z',
  ledger_block_index: 2,
};
const IN_TRANSIT = {
  event_type: 'SHIPMENT_UPDATED',
  label: 'Shipment',
  actor_role: 'distributor',
  status: 'In Transit',
  note: null,
  timestamp: '2026-11-27T12:00:00.000Z',
  ledger_block_index: 3,
};
const DELIVERED = {
  event_type: 'SHIPMENT_UPDATED',
  label: 'Shipment',
  actor_role: 'distributor',
  status: 'Delivered to Retailer',
  note: null,
  timestamp: '2026-11-27T18:00:00.000Z',
  ledger_block_index: 4,
};
const RECEIVED = {
  event_type: 'RECEIPT_CONFIRMED',
  label: 'Receipt',
  actor_role: 'retailer',
  status: 'Received by Retailer',
  note: null,
  timestamp: '2026-11-28T09:00:00.000Z',
  ledger_block_index: 5,
};

function record({ status, events, product = {} }) {
  return {
    batch: {
      batch_id: BATCH_ID,
      product_name: 'Basmati Rice',
      description: 'Long-grain rice.',
      quantity: 250,
      unit: 'kg',
      harvest_date: '2026-10-15',
      origin: 'Green Valley Farm',
      current_status: status,
      ...product,
    },
    count: events.length,
    events,
  };
}

function milestoneStates(container) {
  return [...container.querySelectorAll('[data-milestone]')].map((item) => [item.dataset.milestone, item.dataset.state]);
}

describe('public product journey', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', `/track/${BATCH_ID}`);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the product overview: description, quantity, origin, harvest date and latest update', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(record({ status: 'Shipped', events: [REGISTERED, SHIPPED] }));
    render(<ConsumerTrackingPage batchId={BATCH_ID} />);

    const overview = await screen.findByRole('region', { name: 'Product overview' });
    expect(within(overview).getByText('Long-grain rice.')).toBeTruthy();
    expect(within(overview).getByText('250 kg')).toBeTruthy();
    expect(within(overview).getByText('2026-10-15')).toBeTruthy();
    expect(within(overview).getByText('Latest recorded update')).toBeTruthy();
    expect(within(overview).getByText('Shipped', { selector: '.tracking-status-pill' })).toBeTruthy();
  });

  it('omits the description and harvest date when the record does not have them', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(
      record({ status: 'Registered', events: [REGISTERED], product: { description: null, harvest_date: null } }),
    );
    render(<ConsumerTrackingPage batchId={BATCH_ID} />);

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    expect(screen.queryByText('Long-grain rice.')).toBeNull();
    expect(screen.queryByText('Harvest date')).toBeNull();
  });

  it('marks completed, current and pending milestones distinctly for a product in transit', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(
      record({ status: 'In Transit', events: [REGISTERED, SHIPPED, IN_TRANSIT] }),
    );
    const { container } = render(<ConsumerTrackingPage batchId={BATCH_ID} />);
    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });

    expect(milestoneStates(container)).toEqual([
      ['registered', 'completed'],
      ['shipped', 'completed'],
      ['in-transit', 'current'],
      ['delivered', 'pending'],
      ['received', 'pending'],
    ]);
    const pending = container.querySelector('[data-milestone="delivered"]');
    expect(within(pending).getByText('Not yet recorded')).toBeTruthy();
    const current = container.querySelector('[data-milestone="in-transit"]');
    expect(within(current).getByText('Current')).toBeTruthy();
  });

  it('shows a received batch with every milestone completed and the receipt details', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(
      record({ status: 'Received by Retailer', events: [REGISTERED, SHIPPED, IN_TRANSIT, DELIVERED, RECEIVED] }),
    );
    render(<ConsumerTrackingPage batchId={BATCH_ID} />);

    const handover = await screen.findByRole('region', { name: 'Retailer receipt and handover' });
    expect(within(handover).getByText('Retailer')).toBeTruthy();
    expect(within(handover).getByText('Received by Retailer')).toBeTruthy();
    expect(within(handover).getByText('Block 5')).toBeTruthy();
    expect(within(handover).queryByText(/Awaiting/)).toBeNull();
  });

  it('shows that the product is awaiting retailer confirmation after delivery, before receipt', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(
      record({ status: 'Delivered to Retailer', events: [REGISTERED, SHIPPED, IN_TRANSIT, DELIVERED] }),
    );
    render(<ConsumerTrackingPage batchId={BATCH_ID} />);

    const handover = await screen.findByRole('region', { name: 'Retailer receipt and handover' });
    expect(within(handover).getByText(/Awaiting the retailer/)).toBeTruthy();
    expect(within(handover).queryByText('Confirmed by')).toBeNull();
  });

  it('says the product has not reached a retailer when it is still early in the journey', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(record({ status: 'Registered', events: [REGISTERED] }));
    render(<ConsumerTrackingPage batchId={BATCH_ID} />);

    const handover = await screen.findByRole('region', { name: 'Retailer receipt and handover' });
    expect(within(handover).getByText(/Not yet delivered to a retailer/)).toBeTruthy();
  });

  it('renders an incomplete journey safely, with its missing steps shown as not yet recorded', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(record({ status: 'Registered', events: [REGISTERED] }));
    const { container } = render(<ConsumerTrackingPage batchId={BATCH_ID} />);

    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });
    expect(milestoneStates(container)[0]).toEqual(['registered', 'current']);
    expect(milestoneStates(container).slice(1).every(([, state]) => state === 'pending')).toBe(true);
  });

  it('explains a recorded status that is not one of the standard steps, without crashing', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(
      record({ status: 'Legacy Hold', events: [REGISTERED, SHIPPED] }),
    );
    render(<ConsumerTrackingPage batchId={BATCH_ID} />);

    expect(await screen.findByText(/not one of the standard steps/)).toBeTruthy();
  });

  it('lists the shipment movements under their human-readable titles, in order', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(
      record({ status: 'Delivered to Retailer', events: [REGISTERED, SHIPPED, IN_TRANSIT, DELIVERED] }),
    );
    render(<ConsumerTrackingPage batchId={BATCH_ID} />);

    const timeline = await screen.findByRole('list', { name: `Recorded journey of batch ${BATCH_ID}` });
    const titles = [...timeline.querySelectorAll('.tracking-step__title')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
    expect(titles).toEqual([
      'Product registered by Farmer',
      'Shipment initiated by Distributor',
      'In transit by Distributor',
      'Delivered to retailer by Distributor',
    ]);
  });

  it('does not show any private account, identifier or session field', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue(
      record({ status: 'Registered', events: [REGISTERED] }),
    );
    const { container } = render(<ConsumerTrackingPage batchId={BATCH_ID} />);
    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });

    const text = container.textContent;
    expect(text).not.toMatch(/username|password|user_id|created_by|session/i);
  });
});

describe('productJourney helpers', () => {
  it('builds milestones only from recorded events', () => {
    const milestones = buildMilestones('Shipped', [REGISTERED, SHIPPED]);
    expect(milestones.map((m) => m.state)).toEqual(['completed', 'current', 'pending', 'pending', 'pending']);
    expect(milestones[1].firstTimestamp).toBe(SHIPPED.timestamp);
  });

  it('keeps every recorded movement under its milestone, in the order recorded', () => {
    const second = { ...IN_TRANSIT, timestamp: '2026-11-27T14:00:00.000Z', ledger_block_index: 9 };
    const milestones = buildMilestones('In Transit', [REGISTERED, SHIPPED, IN_TRANSIT, second]);
    expect(milestones[2].events.map((e) => e.timestamp)).toEqual([IN_TRANSIT.timestamp, second.timestamp]);
  });

  it('gives a useful title and role for every event type', () => {
    expect(eventTitle(REGISTERED)).toEqual({ title: 'Product registered', role: 'Farmer' });
    expect(eventTitle(RECEIVED)).toEqual({ title: 'Receipt confirmed', role: 'Retailer' });
    expect(eventTitle({ event_type: 'SHIPMENT_UPDATED', status: 'Legacy', actor_role: 'distributor' }).title).toBe(
      'Shipment update: Legacy',
    );
  });

  it('reports the latest update time and the receipt only when recorded', () => {
    expect(latestUpdate([REGISTERED, RECEIVED])).toBe(RECEIVED.timestamp);
    expect(latestUpdate([])).toBeNull();
    expect(receiptSummary([REGISTERED, SHIPPED])).toBeNull();
    expect(receiptSummary([REGISTERED, RECEIVED])).toEqual({
      timestamp: RECEIVED.timestamp,
      confirmedBy: 'Retailer',
      status: 'Received by Retailer',
      ledgerBlockIndex: 5,
    });
  });
});
