// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import App from './App.jsx';
import * as accessService from './services/accessService.js';
import * as receiptService from './services/receiptService.js';
import { fetchHealth } from './services/healthService.js';

vi.mock('./services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
  fetchRoleActions: vi.fn(),
}));

vi.mock('./services/receiptService.js', () => ({
  fetchAwaitingReceipts: vi.fn(),
  confirmReceipt: vi.fn(),
}));

vi.mock('./services/shipmentService.js', () => ({
  fetchShipmentBatches: vi.fn().mockResolvedValue([]),
  createShipment: vi.fn(),
}));

vi.mock('./services/batchService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchBatches: vi.fn().mockResolvedValue([]),
  createBatch: vi.fn(),
}));

vi.mock('./services/ledgerService.js', () => ({
  fetchLedger: vi.fn().mockResolvedValue({ count: 0, latest: null, blocks: [] }),
}));

vi.mock('./services/healthService.js', () => ({
  fetchHealth: vi.fn(),
}));

const ROLES = [
  { key: 'farmer', label: 'Farmer', description: 'Register agricultural product batches.' },
  { key: 'distributor', label: 'Distributor', description: 'View batches and record shipments.' },
  { key: 'retailer', label: 'Retailer', description: 'View incoming batches and confirm receipt.' },
];

function session(role, label, name) {
  return { active: true, role, role_label: label, display_name: name };
}

function actionsFor(role) {
  const map = {
    farmer: [{ key: 'register_batch', label: 'Register product batch', available: true }],
    distributor: [{ key: 'record_shipment', label: 'Record shipment update', available: true }],
    retailer: [{ key: 'confirm_receipt', label: 'Confirm receipt of batch', available: true }],
  };
  return { role, role_label: role, actions: map[role] };
}

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

describe('Retailer receipt panel in the app', () => {
  beforeEach(() => {
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchRoleActions.mockImplementation(async () => actionsFor('retailer'));
    receiptService.fetchAwaitingReceipts.mockResolvedValue([AWAITING]);
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the receipt panel with the awaiting batch to an active Retailer', async () => {
    accessService.fetchSession.mockResolvedValue(session('retailer', 'Retailer', 'Demo Retailer'));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Retailer workspace' })).toBeTruthy();
    expect(await screen.findByRole('radio', { name: 'Select batch PB-7K2M-9QXD' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm receipt' })).toBeTruthy();
    expect(receiptService.fetchAwaitingReceipts).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['farmer', 'Farmer'],
    ['distributor', 'Distributor'],
  ])('a %s session does not see or load the retailer receipt panel', async (role, label) => {
    accessService.fetchSession.mockResolvedValue(session(role, label, `Demo ${label}`));
    accessService.fetchRoleActions.mockImplementation(async () => actionsFor(role));
    render(<App />);

    expect(await screen.findByRole('heading', { name: `${label} workspace` })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Batches awaiting receipt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm receipt' })).toBeNull();
    expect(receiptService.fetchAwaitingReceipts).not.toHaveBeenCalled();
    expect(receiptService.confirmReceipt).not.toHaveBeenCalled();
  });
});
