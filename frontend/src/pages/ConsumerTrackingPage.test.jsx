// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../services/apiClient.js';
import * as trackingService from '../services/trackingService.js';
import ConsumerTrackingPage from './ConsumerTrackingPage.jsx';

vi.mock('../services/trackingService.js', () => ({
  fetchPublicTracking: vi.fn(),
}));

const VIEW = {
  batch: {
    batch_id: 'PB-7K2M-9QXD',
    product_name: 'Basmati Rice',
    origin: 'Green Valley Farm',
    current_status: 'Received by Retailer',
  },
  count: 4,
  events: [
    {
      event_type: 'PRODUCT_REGISTERED',
      label: 'Registration',
      actor_role: 'farmer',
      status: 'Registered',
      note: null,
      timestamp: '2026-11-26T10:00:00.000Z',
      ledger_block_index: 1,
    },
    {
      event_type: 'SHIPMENT_UPDATED',
      label: 'Shipment',
      actor_role: 'distributor',
      status: 'Shipped',
      note: 'Left the farm',
      timestamp: '2026-11-26T11:00:00.000Z',
      ledger_block_index: 2,
    },
    {
      event_type: 'SHIPMENT_UPDATED',
      label: 'Shipment',
      actor_role: 'distributor',
      status: 'Delivered to Retailer',
      note: null,
      timestamp: '2026-11-26T12:00:00.000Z',
      ledger_block_index: 3,
    },
    {
      event_type: 'RECEIPT_CONFIRMED',
      label: 'Receipt',
      actor_role: 'retailer',
      status: 'Received by Retailer',
      note: null,
      timestamp: '2026-11-26T13:00:00.000Z',
      ledger_block_index: 4,
    },
  ],
};

describe('ConsumerTrackingPage', () => {
  beforeEach(() => {
    trackingService.fetchPublicTracking.mockResolvedValue(VIEW);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading state while the record is fetched', () => {
    trackingService.fetchPublicTracking.mockReturnValue(new Promise(() => {}));

    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);

    expect(screen.getByRole('status').textContent).toBe('Loading the batch record…');
  });

  it('displays the batch ID prominently with product, origin and current status', async () => {
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' })).toBeTruthy();
    expect(screen.getByText('PB-7K2M-9QXD', { selector: '.tracking-batch-id' })).toBeTruthy();
    expect(screen.getByText('Green Valley Farm')).toBeTruthy();
    expect(screen.getByText('Received by Retailer', { selector: '.tracking-status-pill' })).toBeTruthy();
  });

  it('renders the history in chronological order with registration, shipment and receipt distinguishable', async () => {
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);

    const timeline = await screen.findByRole('list', { name: 'Recorded journey of batch PB-7K2M-9QXD' });
    const steps = within(timeline).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.getAttribute('data-event-type'))).toEqual([
      'PRODUCT_REGISTERED',
      'SHIPMENT_UPDATED',
      'SHIPMENT_UPDATED',
      'RECEIPT_CONFIRMED',
    ]);
    expect(within(steps[0]).getByText('Registration').className).toContain('tracking-kind--registration');
    expect(within(steps[1]).getByText('Shipment').className).toContain('tracking-kind--shipment');
    expect(within(steps[3]).getByText('Receipt').className).toContain('tracking-kind--receipt');
    const times = steps.map((step) => step.querySelector('time').getAttribute('datetime'));
    expect(times).toEqual([...times].sort());
  });

  it('shows the actor, status, note when present, and ledger block index', async () => {
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);

    const timeline = await screen.findByRole('list', { name: 'Recorded journey of batch PB-7K2M-9QXD' });
    const [registration, shipped] = within(timeline).getAllByRole('listitem');
    expect(within(registration).getByText('farmer')).toBeTruthy();
    expect(within(registration).getByText('Block 1')).toBeTruthy();
    expect(within(shipped).getByText('Left the farm')).toBeTruthy();
    expect(within(shipped).getByText('distributor')).toBeTruthy();
  });

  it('omits the note field when an event has no note', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue({ ...VIEW, events: [VIEW.events[0]] });
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);

    await screen.findByRole('list', { name: 'Recorded journey of batch PB-7K2M-9QXD' });
    expect(screen.queryByText('Note')).toBeNull();
  });

  it('shows an empty history message when no events are recorded', async () => {
    trackingService.fetchPublicTracking.mockResolvedValue({ ...VIEW, count: 0, events: [] });
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);

    expect(await screen.findByText('No events have been recorded for this batch yet.')).toBeTruthy();
  });

  it('shows a not-found message for an unknown batch', async () => {
    trackingService.fetchPublicTracking.mockRejectedValue(new ApiError('Request failed with status 404.', { status: 404 }));
    render(<ConsumerTrackingPage batchId="PB-ZZZZ-ZZZZ" />);

    expect(await screen.findByRole('heading', { name: 'We could not find this batch' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('PB-ZZZZ-ZZZZ');
  });

  it('shows an invalid-code message for a malformed batch ID', async () => {
    trackingService.fetchPublicTracking.mockRejectedValue(new ApiError('Request failed with status 400.', { status: 400 }));
    render(<ConsumerTrackingPage batchId="bad" />);

    expect(await screen.findByRole('heading', { name: 'This is not a valid batch code' })).toBeTruthy();
  });

  it('shows a network error with advice when the server cannot be reached', async () => {
    trackingService.fetchPublicTracking.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);

    expect(await screen.findByRole('heading', { name: 'The tracking record cannot be reached' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('can reach it on the network'));
  });

  it('is strictly read-only: no buttons, forms, inputs or links to change anything', async () => {
    const { container } = render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);
    await screen.findByRole('list', { name: 'Recorded journey of batch PB-7K2M-9QXD' });

    expect(container.querySelectorAll('button, form, input, select, textarea')).toHaveLength(0);
    expect(container.querySelectorAll('a[href]')).toHaveLength(0);
  });

  it('shows no role, login or workspace content', async () => {
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);
    await screen.findByRole('list', { name: 'Recorded journey of batch PB-7K2M-9QXD' });

    expect(screen.queryByText(/Choose a demonstration role/)).toBeNull();
    expect(screen.queryByText(/workspace/i)).toBeNull();
    expect(screen.queryByText(/Exit session/)).toBeNull();
    expect(screen.queryByText(/Active role/)).toBeNull();
  });

  it('sets a page title that names the batch', async () => {
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);
    await screen.findByRole('list', { name: 'Recorded journey of batch PB-7K2M-9QXD' });

    expect(document.title).toBe('Batch PB-7K2M-9QXD · Product tracking');
  });

  it('requests the batch with the ID from the route', async () => {
    render(<ConsumerTrackingPage batchId="PB-7K2M-9QXD" />);
    await screen.findByRole('heading', { name: 'Basmati Rice' });

    expect(trackingService.fetchPublicTracking).toHaveBeenCalledWith('PB-7K2M-9QXD', expect.any(Object));
  });
});
