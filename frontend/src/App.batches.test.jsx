// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App.jsx';
import * as accessService from './services/accessService.js';
import { ApiError } from './services/apiClient.js';
import * as batchService from './services/batchService.js';
import { fetchHealth } from './services/healthService.js';

vi.mock('./services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
  fetchRoleActions: vi.fn(),
}));

vi.mock('./services/batchService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createBatch: vi.fn(),
  fetchBatches: vi.fn(),
}));

vi.mock('./services/healthService.js', () => ({
  fetchHealth: vi.fn(),
}));

const ROLES = [
  { key: 'farmer', label: 'Farmer', description: 'Register agricultural product batches.' },
  { key: 'distributor', label: 'Distributor', description: 'View batches and record shipments.' },
  { key: 'retailer', label: 'Retailer', description: 'View incoming batches and confirm receipt.' },
];

const SIGNED_OUT = { active: false, role: null, role_label: null, display_name: null };

const SAVED_BATCH = {
  id: 1,
  product_name: 'Basmati Rice',
  description: 'Long-grain rice.',
  quantity: 250,
  unit: 'kg',
  origin: 'Green Valley Farm',
  harvest_date: '2026-10-15',
  current_status: 'Registered',
  created_at: '2026-11-26T10:00:00.000Z',
};

function session(role, label, displayName) {
  return { active: true, role, role_label: label, display_name: displayName };
}

function actionsFor(role) {
  const map = {
    farmer: [{ key: 'register_batch', label: 'Register product batch', available: true }],
    distributor: [{ key: 'record_shipment', label: 'Record shipment update', available: false }],
    retailer: [{ key: 'confirm_receipt', label: 'Confirm receipt of batch', available: false }],
  };
  return { role, role_label: role, actions: map[role] };
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'Basmati Rice' } });
  fireEvent.change(screen.getByLabelText(/Origin or farm location/), { target: { value: 'Green Valley Farm' } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '250' } });
  fireEvent.change(screen.getByLabelText(/^Unit/), { target: { value: 'kg' } });
  fireEvent.change(screen.getByLabelText(/Harvest or registration date/), { target: { value: '2026-10-15' } });
}

describe('Farmer batch registration in the app', () => {
  beforeEach(() => {
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchSession.mockResolvedValue(session('farmer', 'Farmer', 'Demo Farmer'));
    accessService.fetchRoleActions.mockResolvedValue(actionsFor('farmer'));
    batchService.fetchBatches.mockResolvedValue([]);
    batchService.createBatch.mockResolvedValue(SAVED_BATCH);
    fetchHealth.mockResolvedValue({
      status: 'ok',
      application: 'Blockchain Product Tracking',
      database: { status: 'connected', schema_initialized: true },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the registration form with the required fields to an active Farmer', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Register a product batch' })).toBeTruthy();
    expect(screen.getByLabelText(/Product name/)).toBeTruthy();
    expect(screen.getByLabelText(/Origin or farm location/)).toBeTruthy();
    expect(screen.getByLabelText(/Quantity/)).toBeTruthy();
    expect(screen.getByLabelText(/^Unit/)).toBeTruthy();
    expect(screen.getByLabelText(/Harvest or registration date/)).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Register batch' })).toBeTruthy();
  });

  it('submits a valid batch, shows the confirmation and details, and refreshes the list', async () => {
    batchService.fetchBatches
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([SAVED_BATCH]);
    render(<App />);
    await screen.findByRole('button', { name: 'Register batch' });

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));

    expect(await screen.findByText('Batch registered.')).toBeTruthy();
    const details = screen.getByRole('region', { name: 'Basmati Rice' });
    expect(within(details).getByText('250 kg')).toBeTruthy();
    expect(within(details).getByText('Green Valley Farm')).toBeTruthy();
    expect(within(details).getByText('2026-10-15')).toBeTruthy();
    expect(within(details).getByText('Registered')).toBeTruthy();

    const list = await screen.findByRole('table');
    expect(within(list).getByText('Basmati Rice')).toBeTruthy();
    expect(batchService.fetchBatches).toHaveBeenCalledTimes(2);
  });

  it('shows the backend error and keeps the farmer on the form when registration fails', async () => {
    batchService.createBatch.mockRejectedValue(
      new ApiError('Request to /api/batches failed with status 409.', {
        status: 409,
        body: { error: { code: 409, name: 'Conflict', message: 'This submission key was already used for a different batch.' } },
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: 'Register batch' });
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('already used for a different batch');
    expect(screen.getByRole('button', { name: 'Register batch' })).toBeTruthy();
    expect(screen.queryByText('Batch registered.')).toBeNull();
  });

  it('shows an error when the batch list cannot be loaded', async () => {
    batchService.fetchBatches.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('Could not load your batches. Make sure the backend is running.')).toBeTruthy(),
    );
  });

  it('shows the empty list message when the farmer has no batches yet', async () => {
    render(<App />);

    expect(await screen.findByText('No batches registered yet.')).toBeTruthy();
  });
});

describe('Batch registration is hidden from other roles', () => {
  beforeEach(() => {
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    batchService.fetchBatches.mockResolvedValue([]);
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ['distributor', 'Distributor', 'Record shipment update'],
    ['retailer', 'Retailer', 'Confirm receipt of batch'],
  ])('a %s session has no batch form, no registration action and never calls the batch API', async (role, label, action) => {
    accessService.startSession.mockResolvedValue(session(role, label, `Demo ${label}`));
    accessService.fetchRoleActions.mockResolvedValue(actionsFor(role));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }));

    expect(await screen.findByRole('heading', { name: `${label} workspace` })).toBeTruthy();
    expect(await screen.findByText(action)).toBeTruthy();
    expect(screen.queryByLabelText(/Product name/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Register batch' })).toBeNull();
    expect(screen.queryByText('Register a product batch')).toBeNull();
    expect(screen.queryByText('Register product batch')).toBeNull();
    expect(batchService.fetchBatches).not.toHaveBeenCalled();
    expect(batchService.createBatch).not.toHaveBeenCalled();
  });
});
