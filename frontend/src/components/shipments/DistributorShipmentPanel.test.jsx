// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../services/apiClient.js';
import * as shipmentService from '../../services/shipmentService.js';
import DistributorShipmentPanel from './DistributorShipmentPanel.jsx';

vi.mock('../../services/shipmentService.js', () => ({
  fetchShipmentBatches: vi.fn(),
  createShipment: vi.fn(),
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

describe('DistributorShipmentPanel', () => {
  beforeEach(() => {
    shipmentService.fetchShipmentBatches.mockResolvedValue([BATCH]);
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

  it('lists registered batches with their identification and current status', async () => {
    render(<DistributorShipmentPanel />);

    const table = await screen.findByRole('table', { name: 'Batches available for shipment updates' });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('PB-7K2M-9QXD')).toBeTruthy();
    expect(within(row).getByText('Basmati Rice')).toBeTruthy();
    expect(within(row).getByText('Green Valley Farm')).toBeTruthy();
    expect(within(row).getByText('250 kg')).toBeTruthy();
    expect(within(row).getByText('Registered')).toBeTruthy();
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

  it('offers exactly the three supported shipment statuses', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    const options = within(screen.getByLabelText(/Shipment status/)).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Choose a status',
      'Shipped',
      'In Transit',
      'Delivered to Retailer',
    ]);
  });

  it('accepts an optional note of one line up to the limit', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    const note = screen.getByLabelText('Note (optional)');
    expect(note.getAttribute('maxlength')).toBe('300');
    fireEvent.change(note, { target: { value: 'Refrigerated truck' } });

    expect(note.value).toBe('Refrigerated truck');
  });

  it('shows the selected batch in the form heading area', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');

    selectBatch();

    expect(screen.getByText(/Selected:/).textContent).toContain('PB-7K2M-9QXD');
  });

  it('shows a validation message and sends nothing when no batch is selected', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText(/Shipment status/), { target: { value: 'Shipped' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    expect(await screen.findByText('Select a batch to update.')).toBeTruthy();
    expect(shipmentService.createShipment).not.toHaveBeenCalled();
  });

  it('shows a validation message and sends nothing when no status is chosen', async () => {
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    expect(await screen.findByText('Choose a shipment status.')).toBeTruthy();
    expect(shipmentService.createShipment).not.toHaveBeenCalled();
  });

  it('submits the selected batch, status and note with a submission key, then shows the saved update', async () => {
    shipmentService.createShipment.mockResolvedValue(SAVED);
    shipmentService.fetchShipmentBatches
      .mockResolvedValueOnce([BATCH])
      .mockResolvedValueOnce([{ ...BATCH, current_status: 'Shipped' }]);
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();
    fireEvent.change(screen.getByLabelText(/Shipment status/), { target: { value: 'Shipped' } });
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: '  Cold chain ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

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

  it('refreshes the batch list so the new status is displayed', async () => {
    shipmentService.createShipment.mockResolvedValue(SAVED);
    shipmentService.fetchShipmentBatches
      .mockResolvedValueOnce([BATCH])
      .mockResolvedValueOnce([{ ...BATCH, current_status: 'Shipped' }]);
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();
    fireEvent.change(screen.getByLabelText(/Shipment status/), { target: { value: 'Shipped' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    await waitFor(() => expect(shipmentService.fetchShipmentBatches).toHaveBeenCalledTimes(2));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Shipped')).toBeTruthy();
    expect(within(table).queryByText('Registered')).toBeNull();
  });

  it('disables the button and shows a saving state while the update is in progress', async () => {
    shipmentService.createShipment.mockReturnValue(new Promise(() => {}));
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();
    fireEvent.change(screen.getByLabelText(/Shipment status/), { target: { value: 'In Transit' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    const busy = await screen.findByRole('button', { name: 'Saving…' });
    expect(busy.disabled).toBe(true);
    expect(screen.getByText('Saving shipment update…')).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText(/Shipment status/), { target: { value: 'Shipped' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    expect(await screen.findByText('Note must be a single line of plain text.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Please correct the highlighted fields.');
  });

  it('shows the conflict message from the server', async () => {
    shipmentService.createShipment.mockRejectedValue(
      new ApiError('Request failed with status 409.', {
        status: 409,
        body: { error: { code: 409, message: 'This submission key was already used for a different shipment.' } },
      }),
    );
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();
    fireEvent.change(screen.getByLabelText(/Shipment status/), { target: { value: 'Shipped' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('already used for a different shipment');
    expect(screen.queryByText('Shipment saved.')).toBeNull();
  });

  it('shows a network message when the server cannot be reached', async () => {
    shipmentService.createShipment.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<DistributorShipmentPanel />);
    await screen.findByRole('table');
    selectBatch();
    fireEvent.change(screen.getByLabelText(/Shipment status/), { target: { value: 'Shipped' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shipment update' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the server');
  });
});
