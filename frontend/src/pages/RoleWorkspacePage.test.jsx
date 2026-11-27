// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RoleWorkspacePage from './RoleWorkspacePage.jsx';
import * as accessService from '../services/accessService.js';

vi.mock('../services/accessService.js', () => ({
  fetchRoleActions: vi.fn(),
}));

// The panels load their own data; keep those calls off the network in these tests.
vi.mock('../components/batches/FarmerBatchPanel.jsx', () => ({ default: () => <p>farmer panel</p> }));
vi.mock('../components/shipments/DistributorShipmentPanel.jsx', () => ({ default: () => <p>distributor panel</p> }));
vi.mock('../components/receipts/RetailerReceiptPanel.jsx', () => ({ default: () => <p>retailer panel</p> }));
vi.mock('../components/ledger/LedgerView.jsx', () => ({ default: () => <p>ledger</p> }));
vi.mock('../components/history/BatchHistoryPanel.jsx', () => ({ default: () => <p>history</p> }));
vi.mock('../components/history/LedgerVerificationPanel.jsx', () => ({ default: () => <p>verification</p> }));

const WORKSPACES = {
  farmer: { label: 'Farmer', links: ['Dashboard', 'Product batches and registration', 'Batch history', 'Ledger'] },
  distributor: { label: 'Distributor', links: ['Dashboard', 'Eligible batches and shipment updates', 'Batch history', 'Ledger'] },
  retailer: { label: 'Retailer', links: ['Dashboard', 'Awaiting receipts and confirmation', 'Batch history', 'Ledger'] },
};

function renderWorkspace(role) {
  const { label } = WORKSPACES[role];
  return render(<RoleWorkspacePage role={role} roleLabel={label} roleDescription={null} />);
}

function activeLinks() {
  return [...document.querySelectorAll('.role-nav__link--active')].map((link) => link.textContent);
}

describe('RoleWorkspacePage navigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    accessService.fetchRoleActions.mockResolvedValue({ role: 'farmer', role_label: 'Farmer', actions: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it.each(Object.keys(WORKSPACES))('a %s sees only its own navigation links', async (role) => {
    renderWorkspace(role);

    const nav = screen.getByRole('navigation', { name: `${WORKSPACES[role].label} workspace sections` });
    const names = [...nav.querySelectorAll('a')].map((link) => link.textContent);
    expect(names).toEqual(WORKSPACES[role].links);
    for (const other of Object.keys(WORKSPACES).filter((key) => key !== role)) {
      expect(nav.textContent).not.toContain(WORKSPACES[other].label + ' workspace');
    }
  });

  it('marks the dashboard as the current section when there is no hash', async () => {
    renderWorkspace('farmer');

    expect(activeLinks()).toEqual(['Dashboard']);
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('location');
  });

  it('clicking a link makes it the only active section', async () => {
    renderWorkspace('retailer');

    fireEvent.click(screen.getByRole('link', { name: 'Ledger' }));

    expect(activeLinks()).toEqual(['Ledger']);
    expect(screen.getByRole('link', { name: 'Ledger' }).getAttribute('aria-current')).toBe('location');
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
  });

  it('follows the address hash when the section changes', async () => {
    renderWorkspace('distributor');

    window.history.replaceState({}, '', '/distributor#batch-history');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    await waitFor(() => expect(activeLinks()).toEqual(['Batch history']));
  });

  it('keeps each section link pointing at a section that exists in the workspace', async () => {
    renderWorkspace('farmer');

    for (const link of document.querySelectorAll('.role-nav__link')) {
      const id = link.getAttribute('href').slice(1);
      expect(document.getElementById(id), `missing anchor #${id}`).not.toBeNull();
    }
  });
});
