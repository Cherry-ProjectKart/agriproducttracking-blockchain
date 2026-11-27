// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import * as batchService from '../services/batchService.js';
import * as receiptService from '../services/receiptService.js';
import * as shipmentService from '../services/shipmentService.js';
import WorkspaceSummary from './WorkspaceSummary.jsx';
import FarmerBatchPanel from './batches/FarmerBatchPanel.jsx';
import DistributorShipmentPanel from './shipments/DistributorShipmentPanel.jsx';
import RetailerReceiptPanel from './receipts/RetailerReceiptPanel.jsx';

vi.mock('../services/batchService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchBatches: vi.fn(),
  createBatch: vi.fn(),
}));

vi.mock('../services/shipmentService.js', () => ({
  fetchShipmentBatches: vi.fn(),
  createShipment: vi.fn(),
}));

vi.mock('../services/receiptService.js', () => ({
  fetchAwaitingReceipts: vi.fn(),
  confirmReceipt: vi.fn(),
}));

function batch(id, status, createdAt = '2026-11-26T10:00:00.000Z') {
  return {
    id,
    batch_id: `PB-${id}AA-AAAA`,
    product_name: `Product ${id}`,
    origin: 'Green Valley Farm',
    quantity: 10,
    unit: 'kg',
    harvest_date: '2026-10-15',
    current_status: status,
    created_at: createdAt,
  };
}

describe('WorkspaceSummary', () => {
  afterEach(cleanup);

  it('renders each label with its value as a labelled description list', () => {
    render(<WorkspaceSummary label="Test summary" items={[{ label: 'Things', value: 7 }]} />);

    const list = document.querySelector('dl');
    expect(list.getAttribute('aria-label')).toBe('Test summary');
    expect(screen.getByText('Things')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });
});

describe('Farmer summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('shows the real count and the newest registration from the loaded batches', async () => {
    batchService.fetchBatches.mockResolvedValue([batch(2, 'Registered', '2026-11-27T09:00:00.000Z'), batch(1, 'Registered')]);
    render(<FarmerBatchPanel />);

    const dl = await waitForSummary('Batch summary');
    expect(within(dl).getByText('Registered batches').nextElementSibling.textContent).toBe('2');
    expect(within(dl).getByText('Latest registration')).toBeTruthy();
  });

  it('reports no batches honestly when the farmer has none', async () => {
    batchService.fetchBatches.mockResolvedValue([]);
    render(<FarmerBatchPanel />);

    const dl = await waitForSummary('Batch summary');
    expect(within(dl).getByText('Registered batches').nextElementSibling.textContent).toBe('0');
    expect(within(dl).getByText('None yet')).toBeTruthy();
  });

  it('shows no summary while the batches are loading or have failed to load', async () => {
    batchService.fetchBatches.mockRejectedValue(new Error('down'));
    render(<FarmerBatchPanel />);

    expect(await screen.findByText(/Could not load your batches/)).toBeTruthy();
    expect(document.querySelector('dl.workspace-summary')).toBeNull();
  });
});

describe('Distributor summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('counts each shipment status from the loaded batches', async () => {
    shipmentService.fetchShipmentBatches.mockResolvedValue([
      batch(1, 'Registered'),
      batch(2, 'Shipped'),
      batch(3, 'In Transit'),
      batch(4, 'In Transit'),
      batch(5, 'Delivered to Retailer'),
    ]);
    render(<DistributorShipmentPanel />);

    const dl = await waitForSummary('Shipment summary');
    expect(within(dl).getByText('Batches available').nextElementSibling.textContent).toBe('5');
    expect(within(dl).getByText('Shipped').nextElementSibling.textContent).toBe('1');
    expect(within(dl).getByText('In transit').nextElementSibling.textContent).toBe('2');
    expect(within(dl).getByText('Delivered to retailer').nextElementSibling.textContent).toBe('1');
  });

  it('hides the summary when there are no batches to ship', async () => {
    shipmentService.fetchShipmentBatches.mockResolvedValue([]);
    render(<DistributorShipmentPanel />);

    expect(await screen.findByText(/No registered batches are available/)).toBeTruthy();
    expect(document.querySelector('dl[aria-label="Shipment summary"]')).toBeNull();
  });
});

describe('Retailer summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('shows how many batches are awaiting receipt', async () => {
    receiptService.fetchAwaitingReceipts.mockResolvedValue([batch(1, 'Delivered to Retailer'), batch(2, 'Delivered to Retailer')]);
    render(<RetailerReceiptPanel />);

    const dl = await waitForSummary('Receipt summary');
    expect(within(dl).getByText('Awaiting receipt').nextElementSibling.textContent).toBe('2');
  });

  it('hides the summary when nothing is awaiting receipt', async () => {
    receiptService.fetchAwaitingReceipts.mockResolvedValue([]);
    render(<RetailerReceiptPanel />);

    expect(await screen.findByText(/No batches are awaiting receipt/)).toBeTruthy();
    expect(document.querySelector('dl[aria-label="Receipt summary"]')).toBeNull();
  });
});

/** Waits for a summary list with the given label and returns it. */
async function waitForSummary(label) {
  return waitFor(() => {
    const dl = document.querySelector(`dl[aria-label="${label}"]`);
    if (!dl) throw new Error(`summary "${label}" not rendered yet`);
    return dl;
  });
}
