// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../services/apiClient.js';
import * as shipmentService from '../../services/shipmentService.js';
import * as historyService from '../../services/historyService.js';
import DistributorShipmentPanel from './DistributorShipmentPanel.jsx';

vi.mock('../../services/shipmentService.js', () => ({
  fetchShipmentBatches: vi.fn(),
  createShipment: vi.fn(),
}));

vi.mock('../../services/historyService.js', () => ({
  fetchBatchHistory: vi.fn(),
}));

const BATCH = {
  batch_id: 'PB-7K2M-9QXD',
  product_name: 'Basmati Rice',
  origin: 'Green Valley Farm',
  quantity: 250,
  unit: 'kg',
  harvest_date: '2026-10-15',
  current_status: 'Registered',
  created_at: '2026-11-26T10:00:00.000Z',
  next_statuses: ['Shipped'],
};

const DELIVERED = {
  ...BATCH,
  batch_id: 'PB-DLVR-0001',
  product_name: 'Maize',
  current_status: 'Delivered to Retailer',
  next_statuses: [],
};

const SAVED = {
  event: {
    event_id: 4,
    event_type: 'SHIPMENT_UPDATED',
    actor_role: 'distributor',
    batch_id: 'PB-7K2M-9QXD',
    status: 'Shipped',
    note: 'Cold chain',
    timestamp: '2026-11-26T17:00:00.000Z',
  },
  batch: { batch_id: 'PB-7K2M-9QXD', current_status: 'Shipped' },
  ledger_block: { index: 2, block_hash: 'b'.repeat(64), previous_hash: 'a'.repeat(64) },
};

function selectBatch(id = 'PB-7K2M-9QXD') {
  fireEvent.click(screen.getByRole('radio', { name: `Select batch ${id}` }));
}

function saveAndConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and record' }));
}

describe('DistributorShipmentPanel', () => {
  beforeEach(() => {
    shipmentService.fetchShipmentBatches.mockResolvedValue([BATCH, DELIVERED]);
    historyService.fetchBatchHistory.mockResolvedValue({ batch: { batch_id: BATCH.batch_id }, count: 0, events: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading state while the batches are fetched', () => {
    shipmentService.fetchShipmentBatches.mockReturnValue(new Promise(() => {}));

    render(<DistributorShipmentPanel />);

    expect(screen.getByRole('status').textContent).toBe('Loading batches…');
  });

  it('lists batches with their identification, status and next movement', async () => {
    render(<DistributorShipmentPanel />);

    const table = await screen.findByRole('table', { name: 'Batches available for shipment updates' });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('PB-7K2M-9QXD')).toBeTruthy();
    expect(within(row).getByText('Basmati Rice')).toBeTruthy();
    expect(within(row).getByText('Green Valley Farm')).toBeTruthy();
    expect(within(row).getByText('250 kg')).toBeTruthy();
    expect(within(row).getByText('Registered')).toBeTruthy();
    expect(within(row).getByText('Shipped')).toBeTruthy();
  });

  it('shows a batch that has no further movement, but cannot select it', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    const radio = screen.getByRole('radio', { name: 'Select batch PB-DLVR-0001' });
    expect(radio.disabled).toBe(true);
    const row = radio.closest('tr');
    expect(within(row).getByText('Delivered to Retailer', { selector: '.shipment-status-pill' })).toBeTruthy();
    expect(within(row).getByText('None')).toBeTruthy();
  });

  it('shows an empty state when no batch is available', async () => {
    shipmentService.fetchShipmentBatches.mockResolvedValue([]);

    render(<DistributorShipmentPanel />);

    expect(await screen.findByText('No registered batches are available for shipment updates yet.')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('shows an error when the batches cannot be loaded', async () => {
    shipmentService.fetchShipmentBatches.mockRejectedValue(new ApiError('Network error while contacting the API.'));

    render(<DistributorShipmentPanel />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not load the batches');
  });

  it('offers only the next status of the selected batch', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    selectBatch();

    const options = within(screen.getByLabelText(/Shipment status/)).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Choose a status', 'Shipped']);
    expect(screen.getByLabelText(/Shipment status/).value).toBe('Shipped');
  });

  it('shows the details of the selected batch and a link to its public tracking page', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    selectBatch();

    const details = screen.getByRole('region', { name: 'Shipment details' });
    expect(within(details).getByText('Green Valley Farm')).toBeTruthy();
    expect(within(details).getByText('2026-10-15')).toBeTruthy();
    expect(within(details).getByText('Shipped')).toBeTruthy();
    const link = within(details).getByRole('link', { name: /Open the public tracking page for PB-7K2M-9QXD/ });
    expect(link.getAttribute('href')).toBe('/track/PB-7K2M-9QXD');
  });

  it('loads the movement history of the selected batch', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    selectBatch();

    await waitFor(() => expect(historyService.fetchBatchHistory).toHaveBeenCalledWith('PB-7K2M-9QXD'));
  });

  it('keeps the save button off until a batch that can move is selected', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    expect(screen.getByRole('button', { name: 'Save shipment update' }).disabled).toBe(true);
    selectBatch();
    expect(screen.getByRole('button', { name: 'Save shipment update' }).disabled).toBe(false);
  });

  it('accepts an optional note of one line up to the limit', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    const note = screen.getByLabelText('Note (optional)');
    expect(note.getAttribute('maxlength')).toBe('300');
    fireEvent.change(note, { target: { value: 'Refrigerated truck' } });

    expect(note.value).toBe('Refrigerated truck');
  });

  it('asks for confirmation before anything is sent, and Cancel sends nothing', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    expect(screen.getByRole('heading', { name: 'Confirm shipment update' })).toBeTruthy();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(shipmentService.createShipment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('heading', { name: 'Confirm shipment update' })).toBeNull();
    expect(shipmentService.createShipment).not.toHaveBeenCalled();
  });

  it('shows a validation message and sends nothing when the note is invalid', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'line one\nline two' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    expect(await screen.findByText('Note must be a single line of plain text.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Confirm shipment update' })).toBeNull();
    expect(shipmentService.createShipment).not.toHaveBeenCalled();
  });

  it('submits the selected batch, status and note with a submission key, then shows the saved update', async () => {
    shipmentService.createShipment.mockResolvedValue(SAVED);
    shipmentService.fetchShipmentBatches
      .mockResolvedValueOnce([BATCH, DELIVERED])
      .mockResolvedValueOnce([{ ...BATCH, current_status: 'Shipped', next_statuses: ['In Transit'] }, DELIVERED]);
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: '  Cold chain ' } });

    saveAndConfirm();

    expect(await screen.findByText('Shipment saved.')).toBeTruthy();
    const [payload, key] = shipmentService.createShipment.mock.calls[0];
    expect(payload).toEqual({ batch_id: 'PB-7K2M-9QXD', status: 'Shipped', note: 'Cold chain' });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    const saved = screen.getByText('Shipment saved.').closest('.alert');
    expect(within(saved).getByText('PB-7K2M-9QXD')).toBeTruthy();
    expect(saved.textContent).toContain('is now');
    expect(saved.textContent).toContain('Shipped');
    expect(saved.textContent).toContain('block 2');
  });

  it('refreshes the batch list and history so the new status and next movement are shown', async () => {
    shipmentService.createShipment.mockResolvedValue(SAVED);
    shipmentService.fetchShipmentBatches
      .mockResolvedValueOnce([BATCH, DELIVERED])
      .mockResolvedValueOnce([{ ...BATCH, current_status: 'Shipped', next_statuses: ['In Transit'] }, DELIVERED]);
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();

    saveAndConfirm();

    await waitFor(() => expect(shipmentService.fetchShipmentBatches).toHaveBeenCalledTimes(2));
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('Shipped', { selector: '.shipment-status-pill' })).toBeTruthy();
    expect(within(row).getByText('In Transit')).toBeTruthy();
    expect(screen.getByLabelText(/Shipment status/).value).toBe('In Transit');
    await waitFor(() => expect(historyService.fetchBatchHistory).toHaveBeenCalledTimes(2));
  });

  it('disables the confirmation while the update is in progress', async () => {
    shipmentService.createShipment.mockReturnValue(new Promise(() => {}));
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();

    saveAndConfirm();

    const busy = await screen.findByRole('button', { name: 'Saving…' });
    expect(busy.disabled).toBe(true);
    expect(screen.getByText('Saving shipment update…')).toBeTruthy();
    expect(shipmentService.createShipment).toHaveBeenCalledTimes(1);
  });

  it('shows the backend validation message for the field the server rejected', async () => {
    shipmentService.createShipment.mockRejectedValue(
      new ApiError('Request to /api/shipments failed with status 400.', {
        status: 400,
        body: {
          error: {
            code: 400,
            name: 'Bad Request',
            message: 'Please correct the highlighted fields.',
            details: { note: 'Note must be a single line of plain text.' },
          },
        },
      }),
    );
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();

    saveAndConfirm();

    expect(await screen.findByText('Note must be a single line of plain text.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Please correct the highlighted fields.');
  });

  it('a conflict from the server explains the movement is not allowed and reloads the batch list', async () => {
    shipmentService.createShipment.mockRejectedValue(
      new ApiError('Request failed with status 409.', {
        status: 409,
        body: {
          error: {
            code: 409,
            message: 'Batch PB-7K2M-9QXD is Shipped. The next shipment update for it is In Transit.',
          },
        },
      }),
    );
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();

    saveAndConfirm();

    expect((await screen.findByRole('alert')).textContent).toContain('The next shipment update for it is In Transit.');
    expect(screen.queryByText('Shipment saved.')).toBeNull();
    await waitFor(() => expect(shipmentService.fetchShipmentBatches).toHaveBeenCalledTimes(2));
  });

  it('shows a network message when the server cannot be reached', async () => {
    shipmentService.createShipment.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();

    saveAndConfirm();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the server');
  });
});
