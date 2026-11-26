// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../services/apiClient.js';
import * as receiptService from '../../services/receiptService.js';
import RetailerReceiptPanel from './RetailerReceiptPanel.jsx';

vi.mock('../../services/receiptService.js', () => ({
  fetchAwaitingReceipts: vi.fn(),
  confirmReceipt: vi.fn(),
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
};

const CONFIRMED = {
  event: {
    event_id: 6,
    event_type: 'RECEIPT_CONFIRMED',
    actor_role: 'retailer',
    batch_id: 'PB-7K2M-9QXD',
    status: 'Received by Retailer',
    timestamp: '2026-11-26T18:00:00.000Z',
  },
  batch: { batch_id: 'PB-7K2M-9QXD', current_status: 'Received by Retailer' },
  ledger_block: { index: 4, block_hash: 'c'.repeat(64), previous_hash: 'b'.repeat(64) },
};

function selectBatch(id = 'PB-7K2M-9QXD') {
  fireEvent.click(screen.getByRole('radio', { name: `Select batch ${id}` }));
}

describe('RetailerReceiptPanel', () => {
  beforeEach(() => {
    receiptService.fetchAwaitingReceipts.mockResolvedValue([AWAITING]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the panel with the awaiting-receipt heading and a loading state first', () => {
    receiptService.fetchAwaitingReceipts.mockReturnValue(new Promise(() => {}));

    render(<RetailerReceiptPanel />);

    expect(screen.getByRole('heading', { name: 'Batches awaiting receipt' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading batches…');
  });

  it('displays awaiting batches with batch ID, product, origin, quantity and current status', async () => {
    render(<RetailerReceiptPanel />);

    const table = await screen.findByRole('table', { name: 'Batches awaiting receipt by the retailer' });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('PB-7K2M-9QXD')).toBeTruthy();
    expect(within(row).getByText('Basmati Rice')).toBeTruthy();
    expect(within(row).getByText('Green Valley Farm')).toBeTruthy();
    expect(within(row).getByText('250 kg')).toBeTruthy();
    expect(within(row).getByText('Delivered to Retailer')).toBeTruthy();
  });

  it('shows an empty state when no batch is awaiting receipt', async () => {
    receiptService.fetchAwaitingReceipts.mockResolvedValue([]);

    render(<RetailerReceiptPanel />);

    expect(await screen.findByText('No batches are awaiting receipt right now.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm receipt' })).toBeNull();
  });

  it('shows an error when the list cannot be loaded', async () => {
    receiptService.fetchAwaitingReceipts.mockRejectedValue(new ApiError('Network error while contacting the API.'));

    render(<RetailerReceiptPanel />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not load the batches awaiting receipt');
  });

  it('makes the confirm action available and describes the status change', async () => {
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    expect(screen.getByRole('button', { name: 'Confirm receipt' })).toBeTruthy();
    expect(screen.getByText(/Received by Retailer/, { selector: 'strong' })).toBeTruthy();
  });

  it('asks for a selection and sends nothing when no batch is selected', async () => {
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    expect(await screen.findByText('Select a batch to confirm.')).toBeTruthy();
    expect(receiptService.confirmReceipt).not.toHaveBeenCalled();
  });

  it('confirms the selected batch with a submission key, then shows the receipt and removes the batch from the list', async () => {
    receiptService.confirmReceipt.mockResolvedValue(CONFIRMED);
    receiptService.fetchAwaitingReceipts.mockResolvedValueOnce([AWAITING]).mockResolvedValueOnce([]);
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    expect(await screen.findByText('Receipt confirmed.')).toBeTruthy();
    const [batchId, key] = receiptService.confirmReceipt.mock.calls[0];
    expect(batchId).toBe('PB-7K2M-9QXD');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    const saved = screen.getByText('Receipt confirmed.').closest('.alert');
    expect(saved.textContent).toContain('is now');
    expect(saved.textContent).toContain('Received by Retailer');
    expect(saved.textContent).toContain('block 4');
    expect(await screen.findByText('No batches are awaiting receipt right now.')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Select batch PB-7K2M-9QXD' })).toBeNull();
  });

  it('shows a saving state while the confirmation is in progress', async () => {
    receiptService.confirmReceipt.mockReturnValue(new Promise(() => {}));
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    const busy = await screen.findByRole('button', { name: 'Confirming…' });
    expect(busy.disabled).toBe(true);
    expect(screen.getByText('Recording the receipt…')).toBeTruthy();
  });

  it('shows the server message when a batch cannot be confirmed', async () => {
    receiptService.confirmReceipt.mockRejectedValue(
      new ApiError('Request failed with status 409.', {
        status: 409,
        body: { error: { code: 409, message: 'This batch is not awaiting receipt. It must be marked Delivered to Retailer first.' } },
      }),
    );
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('not awaiting receipt');
    expect(screen.queryByText('Receipt confirmed.')).toBeNull();
  });

  it('shows a network message when the server cannot be reached', async () => {
    receiptService.confirmReceipt.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<RetailerReceiptPanel />);
    await screen.findByRole('table');
    selectBatch();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not reach the server'));
  });
});
