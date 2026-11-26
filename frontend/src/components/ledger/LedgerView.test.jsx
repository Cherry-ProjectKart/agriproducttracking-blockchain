// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../services/apiClient.js';
import * as ledgerService from '../../services/ledgerService.js';
import LedgerView from './LedgerView.jsx';

vi.mock('../../services/ledgerService.js', () => ({
  fetchLedger: vi.fn(),
}));

const GENESIS = {
  index: 0,
  timestamp: '1970-01-01T00:00:00.000Z',
  event_type: 'GENESIS',
  event_id: null,
  batch_id: null,
  event_data: { event_type: 'GENESIS' },
  previous_hash: '0'.repeat(64),
  block_hash: '20966f2f77cdf6f44a9c38308e39ea2640d576a436e401f39504c3de9447f603',
};

const REGISTRATION = {
  index: 1,
  timestamp: '2026-11-26T16:40:01.123Z',
  event_type: 'PRODUCT_REGISTERED',
  event_id: 3,
  batch_id: 'PB-7K2M-9QXD',
  event_data: { event_type: 'PRODUCT_REGISTERED', batch_id: 'PB-7K2M-9QXD' },
  previous_hash: GENESIS.block_hash,
  block_hash: 'a'.repeat(64),
};

function ledgerBody(blocks) {
  return { count: blocks.length, latest: blocks[blocks.length - 1] ?? null, blocks };
}

describe('LedgerView', () => {
  beforeEach(() => {
    ledgerService.fetchLedger.mockResolvedValue(ledgerBody([GENESIS, REGISTRATION]));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading state before the blocks arrive', () => {
    ledgerService.fetchLedger.mockReturnValue(new Promise(() => {}));

    render(<LedgerView />);

    expect(screen.getByRole('status').textContent).toBe('Loading ledger…');
  });

  it('displays each block with its index, event, batch ID and both hashes', async () => {
    render(<LedgerView />);

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // skip the header row
    expect(rows).toHaveLength(2);

    const registration = rows[1];
    expect(within(registration).getByText('1')).toBeTruthy();
    expect(within(registration).getByText('Product registered')).toBeTruthy();
    expect(within(registration).getByText('PB-7K2M-9QXD')).toBeTruthy();
    expect(within(registration).getByText(REGISTRATION.previous_hash)).toBeTruthy();
    expect(within(registration).getByText(REGISTRATION.block_hash)).toBeTruthy();
  });

  it('labels the genesis block and shows its hashes in full', async () => {
    render(<LedgerView />);

    expect(await screen.findByText('Ledger start')).toBeTruthy();
    const genesisRow = screen.getByText('Ledger start').closest('tr');
    expect(within(genesisRow).getByText(GENESIS.block_hash)).toBeTruthy();
    expect(within(genesisRow).getByText('—')).toBeTruthy(); // no batch for the genesis block
  });

  it('shows the explanation of what the hashes demonstrate', async () => {
    render(<LedgerView />);

    expect(await screen.findByText(/does not prove that the recorded facts are true/)).toBeTruthy();
  });

  it('shows an empty message when the ledger has no blocks', async () => {
    ledgerService.fetchLedger.mockResolvedValue(ledgerBody([]));

    render(<LedgerView />);

    expect(await screen.findByText('The ledger is empty.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an error with a retry action, and loads again when retried', async () => {
    ledgerService.fetchLedger
      .mockRejectedValueOnce(new ApiError('Network error while contacting the API.'))
      .mockResolvedValueOnce(ledgerBody([GENESIS]));

    render(<LedgerView />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not load the ledger');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Ledger start')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(ledgerService.fetchLedger).toHaveBeenCalledTimes(2);
  });

  it('keeps the page usable when the ledger request fails with a server error', async () => {
    ledgerService.fetchLedger.mockRejectedValue(new ApiError('Request failed', { status: 500 }));

    render(<LedgerView />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Local ledger' })).toBeTruthy();
  });
});
