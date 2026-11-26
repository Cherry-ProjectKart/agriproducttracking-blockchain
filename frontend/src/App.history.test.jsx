// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import App from './App.jsx';
import * as accessService from './services/accessService.js';
import * as historyService from './services/historyService.js';
import { fetchHealth } from './services/healthService.js';

vi.mock('./services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
  fetchRoleActions: vi.fn(),
}));

vi.mock('./services/historyService.js', () => ({
  fetchBatchHistory: vi.fn(),
  verifyLedger: vi.fn(),
}));

vi.mock('./services/batchService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchBatches: vi.fn().mockResolvedValue([]),
  createBatch: vi.fn(),
}));

vi.mock('./services/shipmentService.js', () => ({
  fetchShipmentBatches: vi.fn().mockResolvedValue([]),
  createShipment: vi.fn(),
}));

vi.mock('./services/receiptService.js', () => ({
  fetchAwaitingReceipts: vi.fn().mockResolvedValue([]),
  confirmReceipt: vi.fn(),
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

function session(role, label) {
  return { active: true, role, role_label: label, display_name: `Demo ${label}` };
}

function actionsFor(role) {
  return { role, role_label: role, actions: [] };
}

describe('Batch history and integrity in every workspace', () => {
  beforeEach(() => {
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchRoleActions.mockImplementation(async () => actionsFor('farmer'));
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ['farmer', 'Farmer'],
    ['distributor', 'Distributor'],
    ['retailer', 'Retailer'],
  ])('a %s workspace shows batch history and the ledger integrity check', async (role, label) => {
    accessService.fetchSession.mockResolvedValue(session(role, label));
    accessService.fetchRoleActions.mockImplementation(async () => actionsFor(role));
    render(<App />);

    expect(await screen.findByRole('heading', { name: `${label} workspace` })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Batch history' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ledger integrity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verify ledger' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show history' })).toBeTruthy();
  });

  it('loads no history or verification data when a workspace opens', async () => {
    accessService.fetchSession.mockResolvedValue(session('farmer', 'Farmer'));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Farmer workspace' })).toBeTruthy();
    expect(historyService.fetchBatchHistory).not.toHaveBeenCalled();
    expect(historyService.verifyLedger).not.toHaveBeenCalled();
  });
});
