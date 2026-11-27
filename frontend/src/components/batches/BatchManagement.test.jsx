// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FarmerBatchPanel from './FarmerBatchPanel.jsx';
import BatchDescriptionForm from './BatchDescriptionForm.jsx';
import BatchList from './BatchList.jsx';
import BatchHistoryPanel from '../history/BatchHistoryPanel.jsx';
import { ApiError } from '../../services/apiClient.js';
import * as batchService from '../../services/batchService.js';
import * as historyService from '../../services/historyService.js';
import { BATCH_LIMITS, validateBatchForm } from '../../utils/batchValidation.js';

vi.mock('../../services/batchService.js', () => ({
  fetchBatches: vi.fn(),
  createBatch: vi.fn(),
  updateBatchDescription: vi.fn(),
  createSubmissionKey: () => 'test-submission-key-0001',
}));

vi.mock('../../services/historyService.js', () => ({
  fetchBatchHistory: vi.fn(),
}));

const BATCH = {
  id: 7,
  batch_id: 'PB-7K2M-9QXD',
  product_name: 'Basmati Rice',
  description: 'Aged two years.',
  quantity: 250,
  unit: 'kg',
  origin: 'Green Valley Farm',
  harvest_date: '2026-10-15',
  current_status: 'Registered',
  created_at: '2026-11-26T10:00:00.000Z',
  tracking_url: 'http://localhost:5173/track/PB-7K2M-9QXD',
  qr_code_url: '/api/batches/7/qr.png',
};

function apiError(status, message, details) {
  return new ApiError(`failed ${status}`, { status, body: { error: { code: status, message, ...(details ? { details } : {}) } } });
}

describe('BatchDescriptionForm', () => {
  afterEach(cleanup);

  it('shows the saved description and the reason the other details cannot change', () => {
    render(<BatchDescriptionForm batch={BATCH} updateDescription={vi.fn()} />);

    expect(screen.getByLabelText('Description (optional)').value).toBe('Aged two years.');
    expect(screen.getByText(/recorded on the ledger when the batch is registered/)).toBeTruthy();
  });

  it('saves the trimmed description by the batch row id and reports that the batch ID is unchanged', async () => {
    const updated = { ...BATCH, description: 'Now in cold storage.' };
    const updateDescription = vi.fn().mockResolvedValue(updated);
    const onSaved = vi.fn();
    render(<BatchDescriptionForm batch={BATCH} onSaved={onSaved} updateDescription={updateDescription} />);

    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: '  Now in cold storage.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

    expect(await screen.findByText(/Description saved. The batch ID, QR code, tracking page and history are unchanged./)).toBeTruthy();
    expect(updateDescription).toHaveBeenCalledWith(7, 'Now in cold storage.');
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it('keeps the confirmation visible when the parent hands back the saved batch', async () => {
    const saved = { ...BATCH, description: 'Saved and echoed back.' };
    const updateDescription = vi.fn().mockResolvedValue(saved);
    function Parent() {
      const [current, setCurrent] = React.useState(BATCH);
      return <BatchDescriptionForm batch={current} onSaved={setCurrent} updateDescription={updateDescription} />;
    }
    render(<Parent />);

    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Saved and echoed back.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

    await screen.findByText(/Description saved/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText(/Description saved/)).toBeTruthy();
    expect(screen.getByLabelText('Description (optional)').value).toBe('Saved and echoed back.');
  });

  it('shows the server message for a description it refuses', async () => {
    const updateDescription = vi.fn().mockRejectedValue(
      apiError(400, 'Please correct the highlighted fields.', { description: 'Description must be 500 characters or fewer.' }),
    );
    render(<BatchDescriptionForm batch={BATCH} updateDescription={updateDescription} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Description must be 500 characters or fewer.');
  });

  it('shows a general message when the change fails for another reason', async () => {
    const updateDescription = vi.fn().mockRejectedValue(apiError(500, 'An unexpected error occurred.'));
    render(<BatchDescriptionForm batch={BATCH} updateDescription={updateDescription} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

    expect((await screen.findByRole('alert')).textContent).toBe('An unexpected error occurred.');
  });

  it('a double click sends one request', async () => {
    let finish;
    const updateDescription = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    render(<BatchDescriptionForm batch={BATCH} updateDescription={updateDescription} />);

    const button = screen.getByRole('button', { name: 'Save description' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(updateDescription).toHaveBeenCalledTimes(1);
    finish(BATCH);
  });

  it('Cancel returns the text to the saved description without saving', () => {
    const updateDescription = vi.fn();
    render(<BatchDescriptionForm batch={BATCH} updateDescription={updateDescription} />);

    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText('Description (optional)').value).toBe('Aged two years.');
    expect(updateDescription).not.toHaveBeenCalled();
  });

  it('limits the description length in the field itself', () => {
    render(<BatchDescriptionForm batch={BATCH} updateDescription={vi.fn()} />);

    expect(screen.getByLabelText('Description (optional)').getAttribute('maxlength')).toBe(String(BATCH_LIMITS.description));
  });
});

describe('BatchList history action', () => {
  afterEach(cleanup);

  it('offers a History action per batch that passes the batch to the workspace', () => {
    const onViewHistory = vi.fn();
    render(<BatchList batches={[BATCH]} onViewHistory={onViewHistory} />);

    fireEvent.click(screen.getByRole('button', { name: 'View history for batch PB-7K2M-9QXD' }));

    expect(onViewHistory).toHaveBeenCalledWith(BATCH);
  });

  it('shows no History action when the list is used without one', () => {
    render(<BatchList batches={[BATCH]} />);

    expect(screen.queryByRole('button', { name: /View history/ })).toBeNull();
  });
});

describe('BatchHistoryPanel request from the batch list', () => {
  beforeEach(() => {
    historyService.fetchBatchHistory.mockResolvedValue({ batch: { batch_id: 'PB-7K2M-9QXD' }, count: 0, events: [] });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('looks up the requested batch as soon as a request arrives', async () => {
    const { rerender } = render(<BatchHistoryPanel request={null} />);
    expect(historyService.fetchBatchHistory).not.toHaveBeenCalled();

    rerender(<BatchHistoryPanel request={{ batchId: 'PB-7K2M-9QXD', nonce: 1 }} />);

    await waitFor(() => expect(historyService.fetchBatchHistory).toHaveBeenCalledWith('PB-7K2M-9QXD'));
    expect(screen.getByLabelText('Batch ID').value).toBe('PB-7K2M-9QXD');
  });

  it('looks up again for a repeated request for the same batch', async () => {
    const { rerender } = render(<BatchHistoryPanel request={{ batchId: 'PB-7K2M-9QXD', nonce: 1 }} />);
    await waitFor(() => expect(historyService.fetchBatchHistory).toHaveBeenCalledTimes(1));

    rerender(<BatchHistoryPanel request={{ batchId: 'PB-7K2M-9QXD', nonce: 2 }} />);

    await waitFor(() => expect(historyService.fetchBatchHistory).toHaveBeenCalledTimes(2));
  });
});

describe('Farmer batch panel: save and history', () => {
  beforeEach(() => {
    batchService.fetchBatches.mockResolvedValue([BATCH]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('after saving a description, the list shows the saved text and the batch ID is unchanged', async () => {
    batchService.updateBatchDescription.mockResolvedValue({ ...BATCH, description: 'Fresh note' });
    render(<FarmerBatchPanel onViewHistory={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View batch PB-7K2M-9QXD and its QR code' }));
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Fresh note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

    await screen.findByText(/Description saved/);
    // The parent replaces the batch with the saved copy; the confirmation must still be visible.
    expect(screen.getByText(/Description saved/)).toBeTruthy();
    expect(screen.getByText('Fresh note', { selector: 'dd' })).toBeTruthy();
    expect(screen.getAllByText('PB-7K2M-9QXD', { selector: 'code' }).length).toBeGreaterThan(0);
    expect(batchService.updateBatchDescription).toHaveBeenCalledWith(7, 'Fresh note');
  });

  it('passes the batch to the history action of the parent', async () => {
    const onViewHistory = vi.fn();
    render(<FarmerBatchPanel onViewHistory={onViewHistory} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View history for batch PB-7K2M-9QXD' }));

    expect(onViewHistory).toHaveBeenCalledWith(expect.objectContaining({ batch_id: 'PB-7K2M-9QXD' }));
  });
});

describe('quantity ceiling in registration', () => {
  const VALID = {
    productName: 'Rice',
    description: '',
    quantity: '10',
    unit: 'kg',
    origin: 'Farm',
    harvestDate: '2026-10-15',
  };

  it('accepts the largest allowed quantity', () => {
    expect(validateBatchForm({ ...VALID, quantity: String(BATCH_LIMITS.quantityMax) })).toEqual({});
  });

  it('rejects a quantity above the ceiling with a clear message', () => {
    expect(validateBatchForm({ ...VALID, quantity: '1000000001' }).quantity).toBe('Quantity must be 1,000,000,000 or less.');
  });
});
