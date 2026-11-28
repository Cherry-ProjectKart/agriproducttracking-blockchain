// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../services/apiClient.js';
import * as receiptService from '../../services/receiptService.js';
import * as historyService from '../../services/historyService.js';
import RetailerReceiptPanel from './RetailerReceiptPanel.jsx';

vi.mock('../../services/receiptService.js', () => ({
  fetchAwaitingReceipts: vi.fn(),
  fetchReceivedReceipts: vi.fn(),
  confirmReceipt: vi.fn(),
}));

vi.mock('../../services/historyService.js', () => ({
  fetchBatchHistory: vi.fn(),
}));

const AWAITING = {
  batch_id: 'PB-7K2M-9QXD',
  product_name: 'Basmati Rice',
  origin: 'Green Valley Farm',
  quantity: 250,
  unit: 'kg',
  harvest_date: '2026-10-15',
  current_status: 'Delivered to Retailer',
  created_at: '2026-11-26T10:00:00.000Z',
  delivered_at: '2026-11-27T09:30:00.000Z',
};

const RECEIVED = {
  batch_id: 'PB-XAFG-GVJF',
  product_name: 'Maize',
  origin: 'Hill Top Farm',
  quantity: 40,
  unit: 'crates',
  harvest_date: '2026-09-01',
  current_status: 'Received by Retailer',
  created_at: '2026-11-20T10:00:00.000Z',
  received_at: '2026-11-28T08:00:00.000Z',
};

const CONFIRMED = {
  event: {
    event_id: 9,
    event_type: 'RECEIPT_CONFIRMED',
    actor_role: 'retailer',
    batch_id: 'PB-7K2M-9QXD',
    status: 'Received by Retailer',
    timestamp: '2026-11-28T10:15:00.000Z',
  },
  batch: { batch_id: 'PB-7K2M-9QXD', current_status: 'Received by Retailer' },
  ledger_block: { index: 7, block_hash: 'c'.repeat(64), previous_hash: 'd'.repeat(64) },
};

function selectBatch(id = 'PB-7K2M-9QXD') {
  fireEvent.click(screen.getByRole('radio', { name: `Select batch ${id}` }));
}

function requestAndConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm handover' }));
}

describe('RetailerReceiptPanel', () => {
  beforeEach(() => {
    receiptService.fetchAwaitingReceipts.mockResolvedValue([AWAITING]);
    receiptService.fetchReceivedReceipts.mockResolvedValue([]);
    historyService.fetchBatchHistory.mockResolvedValue({ batch: { batch_id: AWAITING.batch_id }, count: 0, events: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading state while the batches are fetched', () => {
    receiptService.fetchAwaitingReceipts.mockReturnValue(new Promise(() => {}));

    render(<RetailerReceiptPanel />);

    expect(screen.getAllByRole('status')[0].textContent).toBe('Loading batches…');
  });

  it('lists batches awaiting receipt with their status and the time they were delivered', async () => {
    render(<RetailerReceiptPanel />);

    const table = await screen.findByRole('table', { name: 'Batches awaiting receipt by the retailer' });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('PB-7K2M-9QXD')).toBeTruthy();
    expect(within(row).getByText('Basmati Rice')).toBeTruthy();
    expect(within(row).getByText('Delivered to Retailer', { selector: '.shipment-status-pill' })).toBeTruthy();
  });

  it('explains which batches can be received', async () => {
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');

    expect(screen.getByText(/Only batches the distributor has marked/)).toBeTruthy();
  });

  it('shows an empty state when no batch is awaiting receipt', async () => {
    receiptService.fetchAwaitingReceipts.mockResolvedValue([]);

    render(<RetailerReceiptPanel />);

    expect(await screen.findByText('No batches are awaiting receipt right now.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows an error when the awaiting batches cannot be loaded', async () => {
    receiptService.fetchAwaitingReceipts.mockRejectedValue(new ApiError('Network error while contacting the API.'));

    render(<RetailerReceiptPanel />);

    expect((await screen.findByText(/Could not load the batches/)).closest('[role="alert"]')).toBeTruthy();
  });

  it('shows the batch details, its delivery time and a link to its public tracking page once selected', async () => {
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');

    selectBatch();

    const details = screen.getByRole('region', { name: 'Batch details' });
    expect(within(details).getByText('Green Valley Farm')).toBeTruthy();
    expect(within(details).getByText('2026-10-15')).toBeTruthy();
    expect(within(details).getByText('Delivered to retailer')).toBeTruthy();
    expect(within(details).getByRole('link', { name: /Open the public tracking page for PB-7K2M-9QXD/ }).getAttribute('href')).toBe(
      '/track/PB-7K2M-9QXD',
    );
  });

  it('loads the shipment and receipt history of the selected batch', async () => {
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');

    selectBatch();

    await waitFor(() => expect(historyService.fetchBatchHistory).toHaveBeenCalledWith('PB-7K2M-9QXD'));
  });

  it('keeps the confirm action off until a batch is selected, and asks for a selection', async () => {
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    expect(await screen.findByText('Select a batch to confirm.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Confirm receipt of this batch/ })).toBeNull();
    expect(receiptService.confirmReceipt).not.toHaveBeenCalled();
  });

  it('asks for confirmation before anything is sent, and Cancel sends nothing', async () => {
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(receiptService.confirmReceipt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/cannot be undone/)).toBeNull();
    expect(receiptService.confirmReceipt).not.toHaveBeenCalled();
  });

  it('confirms the selected batch with a submission key and shows the receipt time', async () => {
    receiptService.confirmReceipt.mockResolvedValue(CONFIRMED);
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    requestAndConfirm();

    expect(await screen.findByText('Receipt confirmed.')).toBeTruthy();
    const [batchId, key] = receiptService.confirmReceipt.mock.calls[0];
    expect(batchId).toBe('PB-7K2M-9QXD');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    const saved = screen.getByText('Receipt confirmed.').closest('.alert');
    expect(saved.textContent).toContain('Received by Retailer');
    expect(saved.textContent).toContain('Received at');
    expect(saved.textContent).toContain('block 7');
  });

  it('disables the confirmation while the receipt is being recorded, so it cannot be sent twice', async () => {
    receiptService.confirmReceipt.mockReturnValue(new Promise(() => {}));
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    requestAndConfirm();

    const busy = await screen.findByRole('button', { name: 'Recording…' });
    expect(busy.disabled).toBe(true);
    expect(screen.getByText('Recording the receipt…')).toBeTruthy();
    expect(receiptService.confirmReceipt).toHaveBeenCalledTimes(1);
  });

  it('shows the server message when a receipt is refused, and reloads the lists on a conflict', async () => {
    receiptService.confirmReceipt.mockRejectedValue(
      new ApiError('Request failed with status 409.', {
        status: 409,
        body: { error: { code: 409, message: 'This batch has already been received by a retailer.' } },
      }),
    );
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    requestAndConfirm();

    expect((await screen.findByRole('alert')).textContent).toContain('already been received by a retailer');
    expect(screen.queryByText('Receipt confirmed.')).toBeNull();
    await waitFor(() => expect(receiptService.fetchAwaitingReceipts).toHaveBeenCalledTimes(2));
    expect(receiptService.fetchReceivedReceipts).toHaveBeenCalledTimes(2);
  });

  it('shows a network message when the server cannot be reached', async () => {
    receiptService.confirmReceipt.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    requestAndConfirm();

    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
  });

  it('lists received batches separately with their receipt time and a history action', async () => {
    receiptService.fetchReceivedReceipts.mockResolvedValue([RECEIVED]);
    render(<RetailerReceiptPanel />);

    const received = await screen.findByRole('table', { name: 'Batches already received by a retailer' });
    const row = within(received).getAllByRole('row')[1];
    expect(within(row).getByText('PB-XAFG-GVJF')).toBeTruthy();
    expect(within(row).getByText('Received by Retailer', { selector: '.shipment-status-pill' })).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'View history for batch PB-XAFG-GVJF' }));
    await waitFor(() => expect(historyService.fetchBatchHistory).toHaveBeenCalledWith('PB-XAFG-GVJF'));
  });

  it('shows an empty state for received batches when none has been received', async () => {
    render(<RetailerReceiptPanel />);

    expect(await screen.findByText('No batches have been received yet.')).toBeTruthy();
  });
});
