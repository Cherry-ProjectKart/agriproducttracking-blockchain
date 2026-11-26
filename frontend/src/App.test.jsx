// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';
import * as accessService from './services/accessService.js';
import { ApiError } from './services/apiClient.js';
import { fetchHealth } from './services/healthService.js';

vi.mock('./services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
  fetchRoleActions: vi.fn(),
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

function activeSession(role, label, displayName) {
  return { active: true, role, role_label: label, display_name: displayName };
}

function farmerActions() {
  return {
    role: 'farmer',
    role_label: 'Farmer',
    actions: [{ key: 'register_batch', label: 'Register product batch', available: false }],
  };
}

const ROLE_BUTTON = {
  farmer: /^Farmer/,
  distributor: /^Distributor/,
  retailer: /^Retailer/,
};

describe('App demo role access', () => {
  beforeEach(() => {
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    accessService.fetchRoleActions.mockResolvedValue(farmerActions());
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

  it('displays all three role options when no session is active', async () => {
    render(<App />);

    for (const key of Object.keys(ROLE_BUTTON)) {
      expect(await screen.findByRole('button', { name: ROLE_BUTTON[key] })).toBeTruthy();
    }
    expect(screen.queryByTestId('active-role')).toBeNull();
  });

  it('selecting a role activates that role experience and shows the active role', async () => {
    accessService.startSession.mockResolvedValue(activeSession('retailer', 'Retailer', 'Demo Retailer'));
    accessService.fetchRoleActions.mockResolvedValue({
      role: 'retailer',
      role_label: 'Retailer',
      actions: [{ key: 'confirm_receipt', label: 'Confirm receipt of batch', available: false }],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: ROLE_BUTTON.retailer }));

    expect(await screen.findByRole('heading', { name: 'Retailer workspace' })).toBeTruthy();
    expect(screen.getByTestId('active-role').textContent).toContain('Retailer');
    expect(await screen.findByText('Confirm receipt of batch')).toBeTruthy();
    expect(accessService.startSession).toHaveBeenCalledWith('retailer');
    expect(screen.queryByRole('button', { name: ROLE_BUTTON.farmer })).toBeNull();
  });

  it('restores an existing active session on load without asking for a role again', async () => {
    accessService.fetchSession.mockResolvedValue(activeSession('farmer', 'Farmer', 'Demo Farmer'));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Farmer workspace' })).toBeTruthy();
    expect(screen.getByTestId('active-role').textContent).toContain('Farmer');
    expect(screen.queryByRole('button', { name: ROLE_BUTTON.distributor })).toBeNull();
  });

  it('exit session clears the role and returns to role selection', async () => {
    accessService.fetchSession.mockResolvedValue(activeSession('farmer', 'Farmer', 'Demo Farmer'));
    accessService.endSession.mockResolvedValue(SIGNED_OUT);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Exit session' }));

    expect(await screen.findByRole('button', { name: ROLE_BUTTON.farmer })).toBeTruthy();
    expect(screen.getByRole('button', { name: ROLE_BUTTON.distributor })).toBeTruthy();
    expect(screen.queryByTestId('active-role')).toBeNull();
    expect(accessService.endSession).toHaveBeenCalledTimes(1);
  });

  it('shows the backend message when a role cannot be started and stays on selection', async () => {
    accessService.startSession.mockRejectedValue(
      new ApiError('Request to /api/session failed with status 503.', {
        status: 503,
        body: {
          error: {
            code: 503,
            name: 'Service Unavailable',
            message: 'Demonstration accounts are not initialised. Run scripts/init_db.py.',
          },
        },
      }),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: ROLE_BUTTON.farmer }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Demonstration accounts are not initialised');
    expect(screen.getByRole('button', { name: ROLE_BUTTON.farmer })).toBeTruthy();
    expect(screen.queryByTestId('active-role')).toBeNull();
  });

  it('reports a session check failure but still offers role selection', async () => {
    accessService.fetchSession.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<App />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not check your session');
    expect(await screen.findByRole('button', { name: ROLE_BUTTON.farmer })).toBeTruthy();
  });

  it('reports a roles load failure instead of showing empty role options', async () => {
    accessService.fetchRoles.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<App />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load the available roles'));
    expect(screen.queryByRole('button', { name: ROLE_BUTTON.farmer })).toBeNull();
  });

  it('reports a failure to load role actions in the workspace', async () => {
    accessService.fetchSession.mockResolvedValue(activeSession('farmer', 'Farmer', 'Demo Farmer'));
    accessService.fetchRoleActions.mockRejectedValue(new ApiError('Unauthorized', { status: 401 }));
    render(<App />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not load the actions for this role');
  });
});
