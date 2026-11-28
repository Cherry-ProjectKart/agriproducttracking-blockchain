// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App.jsx';
import * as accessService from './services/accessService.js';
import * as shipmentService from './services/shipmentService.js';
import { fetchHealth } from './services/healthService.js';

vi.mock('./services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  signIn: vi.fn(),
  endSession: vi.fn(),
  fetchRoleActions: vi.fn(),
}));

vi.mock('./services/shipmentService.js', () => ({
  fetchShipmentBatches: vi.fn(),
  createShipment: vi.fn(),
}));

vi.mock('./services/batchService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchBatches: vi.fn().mockResolvedValue([]),
  createBatch: vi.fn(),
}));

vi.mock('./services/receiptService.js', () => ({
  fetchAwaitingReceipts: vi.fn().mockResolvedValue([]),
  confirmReceipt: vi.fn(),
}));

vi.mock('./services/ledgerService.js', () => ({
  fetchLedger: vi.fn().mockResolvedValue({ count: 0, latest: null, blocks: [] }),
}));

vi.mock('./services/historyService.js', () => ({
  fetchBatchHistory: vi.fn().mockResolvedValue({ batch: { batch_id: 'PB-7K2M-9QXD' }, count: 0, events: [] }),
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
    retailer: [{ key: 'confirm_receipt', label: 'Confirm receipt of batch', available: false }],
  };
  return { role, role_label: role, actions: map[role] };
}

const SHIPMENT_BATCH = {
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

describe('Distributor shipment workspace in the app', () => {
  beforeEach(() => {
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchSession.mockResolvedValue(session('distributor', 'Distributor', 'Demo Distributor'));
    accessService.fetchRoleActions.mockResolvedValue(actionsFor('distributor'));
    shipmentService.fetchShipmentBatches.mockResolvedValue([SHIPMENT_BATCH]);
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the shipment workspace for an active Distributor, with the batch and form', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Distributor workspace' })).toBeTruthy();
    expect(await screen.findByRole('radio', { name: 'Select batch PB-7K2M-9QXD' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Record a shipment update' })).toBeTruthy();
    expect(screen.getByLabelText(/Shipment status/)).toBeTruthy();
    expect(screen.getByLabelText('Note (optional)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save shipment update' })).toBeTruthy();
  });

  it('shows the record shipment action as available in the action list', async () => {
    render(<App />);

    expect(await screen.findByText('Record shipment update')).toBeTruthy();
    const item = screen.getByText('Record shipment update').closest('li');
    expect(item.textContent).toContain('Available');
  });

  it.each([
    ['farmer', 'Farmer'],
    ['retailer', 'Retailer'],
  ])('a %s session has no shipment form, batch selection or shipment data request', async (role, label) => {
    accessService.fetchSession.mockResolvedValue(session(role, label, `Demo ${label}`));
    accessService.fetchRoleActions.mockResolvedValue(actionsFor(role));
    render(<App />);

    expect(await screen.findByRole('heading', { name: `${label} workspace` })).toBeTruthy();
    expect(screen.queryByLabelText(/Shipment status/)).toBeNull();
    expect(screen.queryByRole('radio', { name: /Select batch/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save shipment update' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Record a shipment update' })).toBeNull();
    expect(shipmentService.fetchShipmentBatches).not.toHaveBeenCalled();
    expect(shipmentService.createShipment).not.toHaveBeenCalled();
  });

  it('the Distributor can select a batch and pick a status without leaving the workspace', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Select batch PB-7K2M-9QXD' }));

    fireEvent.change(screen.getByLabelText(/Shipment status/), { target: { value: 'Shipped' } });

    expect(screen.getByLabelText(/Shipment status/).value).toBe('Shipped');
    expect(screen.getByRole('heading', { name: 'Distributor workspace' })).toBeTruthy();
  });
});
