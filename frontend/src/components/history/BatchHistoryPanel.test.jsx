// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../services/apiClient.js';
import * as historyService from '../../services/historyService.js';
import BatchHistoryPanel from './BatchHistoryPanel.jsx';

vi.mock('../../services/historyService.js', () => ({
  fetchBatchHistory: vi.fn(),
  verifyLedger: vi.fn(),
}));

const HISTORY = {
  batch: { batch_id: 'PB-7K2M-9QXD', product_name: 'Basmati Rice', current_status: 'Received by Retailer' },
  count: 4,
  events: [
    {
      event_id: 1,
      event_type: 'PRODUCT_REGISTERED',
      label: 'Registration',
      actor_role: 'farmer',
      status: 'Registered',
      note: null,
      timestamp: '2026-11-26T10:00:00.000Z',
      ledger_block_index: 1,
    },
    {
      event_id: 2,
      event_type: 'SHIPMENT_UPDATED',
      label: 'Shipment',
      actor_role: 'distributor',
      status: 'Shipped',
      note: 'Left the farm',
      timestamp: '2026-11-26T11:00:00.000Z',
      ledger_block_index: 2,
    },
    {
      event_id: 3,
      event_type: 'SHIPMENT_UPDATED',
      label: 'Shipment',
      actor_role: 'distributor',
      status: 'Delivered to Retailer',
      note: null,
      timestamp: '2026-11-26T12:00:00.000Z',
      ledger_block_index: 3,
    },
    {
      event_id: 4,
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

function submitId(id) {
  fireEvent.change(screen.getByLabelText('Batch ID'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
}

describe('BatchHistoryPanel', () => {
  beforeEach(() => {
    historyService.fetchBatchHistory.mockResolvedValue(HISTORY);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('starts idle and does not request anything until a batch ID is submitted', () => {
    render(<BatchHistoryPanel />);

    expect(screen.getByRole('heading', { name: 'Batch history' })).toBeTruthy();
    expect(screen.getByText('Enter a batch ID to see its registration, shipment and receipt events in order.')).toBeTruthy();
    expect(historyService.fetchBatchHistory).not.toHaveBeenCalled();
  });

  it('shows a loading state while the history is requested', () => {
    historyService.fetchBatchHistory.mockReturnValue(new Promise(() => {}));
    render(<BatchHistoryPanel />);

    submitId('PB-7K2M-9QXD');

    expect(screen.getByRole('status').textContent).toBe('Loading history for PB-7K2M-9QXD…');
  });

  it('renders all three supported event types, each distinguishable, with actor, status, note and block', async () => {
    render(<BatchHistoryPanel />);
    submitId('PB-7K2M-9QXD');

    const list = await screen.findByRole('list', { name: 'History of batch PB-7K2M-9QXD' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(within(items[0]).getByText('Registration')).toBeTruthy();
    expect(within(items[1]).getByText('Shipment')).toBeTruthy();
    expect(within(items[3]).getByText('Receipt')).toBeTruthy();
    expect(items[0].getAttribute('data-event-type')).toBe('PRODUCT_REGISTERED');
    expect(items[1].getAttribute('data-event-type')).toBe('SHIPMENT_UPDATED');
    expect(items[3].getAttribute('data-event-type')).toBe('RECEIPT_CONFIRMED');
    expect(within(items[1]).getByText('distributor')).toBeTruthy();
    expect(within(items[1]).getByText('Left the farm')).toBeTruthy();
    expect(within(items[2]).getByText('No note')).toBeTruthy();
    expect(within(items[3]).getByText('Block 4')).toBeTruthy();
  });

  it('displays events in chronological order', async () => {
    render(<BatchHistoryPanel />);
    submitId('PB-7K2M-9QXD');

    const list = await screen.findByRole('list', { name: 'History of batch PB-7K2M-9QXD' });
    const times = within(list)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('time').getAttribute('datetime'));
    expect(times).toEqual([...times].sort());
  });

  it('shows the batch summary above the events', async () => {
    render(<BatchHistoryPanel />);
    submitId('PB-7K2M-9QXD');

    await screen.findByRole('list', { name: 'History of batch PB-7K2M-9QXD' });
    expect(screen.getByText('Basmati Rice,', { exact: false })).toBeTruthy();
    expect(screen.getByText('Received by Retailer', { selector: 'strong' })).toBeTruthy();
  });

  it('shows an empty state when a batch has no events yet', async () => {
    historyService.fetchBatchHistory.mockResolvedValue({ ...HISTORY, count: 0, events: [] });
    render(<BatchHistoryPanel />);
    submitId('PB-7K2M-9QXD');

    expect(await screen.findByText('No events are recorded for this batch yet.')).toBeTruthy();
  });

  it('shows a not-found message for an unknown batch', async () => {
    historyService.fetchBatchHistory.mockRejectedValue(new ApiError('Request failed with status 404.', { status: 404 }));
    render(<BatchHistoryPanel />);
    submitId('PB-ZZZZ-ZZZZ');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('No batch has the ID PB-ZZZZ-ZZZZ.');
  });

  it('shows an error message when the server fails', async () => {
    historyService.fetchBatchHistory.mockRejectedValue(new ApiError('Request failed with status 500.', { status: 500 }));
    render(<BatchHistoryPanel />);
    submitId('PB-7K2M-9QXD');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
  });

  it('shows a network message when the server cannot be reached', async () => {
    historyService.fetchBatchHistory.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<BatchHistoryPanel />);
    submitId('PB-7K2M-9QXD');

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not reach the server'));
  });

  it('refuses a malformed batch ID before any request is made', () => {
    render(<BatchHistoryPanel />);
    submitId('not-a-batch');

    expect(screen.getByText('Enter a batch ID such as PB-7K2M-9QXD.')).toBeTruthy();
    expect(historyService.fetchBatchHistory).not.toHaveBeenCalled();
  });
});
