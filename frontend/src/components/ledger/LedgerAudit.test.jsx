// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LedgerAudit from './LedgerAudit.jsx';
import * as ledgerService from '../../services/ledgerService.js';
import * as historyService from '../../services/historyService.js';

vi.mock('../../services/ledgerService.js', () => ({
  fetchLedger: vi.fn(),
}));

vi.mock('../../services/historyService.js', () => ({
  fetchBatchHistory: vi.fn(),
  verifyLedger: vi.fn(),
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
  event_id: 1,
  batch_id: 'PB-7K2M-9QXD',
  event_data: {
    event_type: 'PRODUCT_REGISTERED',
    event_id: 1,
    batch_id: 'PB-7K2M-9QXD',
    actor_role: 'farmer',
    status: 'Registered',
    product_name: 'Basmati Rice',
    quantity: 250,
    unit: 'kg',
    origin: 'Green Valley Farm',
    harvest_date: '2026-10-15',
  },
  previous_hash: GENESIS.block_hash,
  block_hash: 'a'.repeat(64),
};

const SHIPMENT = {
  index: 2,
  timestamp: '2026-11-27T08:00:00.000Z',
  event_type: 'SHIPMENT_UPDATED',
  event_id: 2,
  batch_id: 'PB-7K2M-9QXD',
  event_data: {
    event_type: 'SHIPMENT_UPDATED',
    event_id: 2,
    batch_id: 'PB-7K2M-9QXD',
    actor_role: 'distributor',
    status: 'Shipped',
    note: 'Left the farm',
    event_timestamp: '2026-11-27T08:00:00.000Z',
  },
  previous_hash: REGISTRATION.block_hash,
  block_hash: 'b'.repeat(64),
};

const BLOCKS = [GENESIS, REGISTRATION, SHIPMENT];

function ledgerBody(blocks) {
  return { count: blocks.length, latest: blocks[blocks.length - 1] ?? null, blocks };
}

function validResult(checked = 3) {
  return {
    result: 'valid',
    checked_blocks: checked,
    latest_block_index: checked - 1,
    recalculated_latest_hash: SHIPMENT.block_hash,
    first_failing_block: null,
    checks: [{ id: 'genesis', label: 'Genesis block', passed: true }],
    failures: [],
    verified_at: '2026-11-28T10:00:00.000Z',
  };
}

function invalidResult() {
  return {
    result: 'invalid',
    checked_blocks: 3,
    latest_block_index: 2,
    recalculated_latest_hash: 'c'.repeat(64),
    first_failing_block: 2,
    checks: [{ id: 'block_hashes', label: 'Block hashes recalculated', passed: false }],
    failures: [{ block_index: 2, check: 'block_hashes', reason: 'The stored block hash does not match the recalculated hash.' }],
    verified_at: '2026-11-28T10:00:00.000Z',
  };
}

describe('LedgerAudit overview', () => {
  beforeEach(() => {
    ledgerService.fetchLedger.mockResolvedValue(ledgerBody(BLOCKS));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows statistics derived from the stored blocks: count, latest block, events and genesis', async () => {
    render(<LedgerAudit />);

    const overview = await screen.findByRole('region', { name: 'Ledger overview' });
    expect(within(overview).getByTestId('ledger-block-count').textContent).toBe('3');
    expect(within(overview).getByText('Block 2')).toBeTruthy();
    expect(within(overview).getByText('2')).toBeTruthy(); // recorded events: the two blocks with an event reference
    expect(within(overview).getByText(/Block 0 · /)).toBeTruthy();
    expect(within(overview).getByText(/Not checked yet/, { selector: '.ledger-overview__verdict' })).toBeTruthy();
  });

  it('derives the statistics from the data, not from fixed values', async () => {
    ledgerService.fetchLedger.mockResolvedValue(ledgerBody([GENESIS]));
    render(<LedgerAudit />);

    const overview = await screen.findByRole('region', { name: 'Ledger overview' });
    expect(within(overview).getByTestId('ledger-block-count').textContent).toBe('1');
    expect(within(overview).getByText('Block 0')).toBeTruthy();
  });

  it('shows Valid and zero failures after a successful check, and the same result in the verification panel', async () => {
    historyService.verifyLedger.mockResolvedValue(validResult());
    render(<LedgerAudit />);
    await screen.findByRole('region', { name: 'Ledger overview' });

    fireEvent.click(screen.getByRole('button', { name: 'Verify ledger' }));

    await waitFor(() => {
      const verdict = document.querySelector('.ledger-overview__verdict--valid');
      expect(verdict?.textContent).toBe('Valid');
    });
    const overview = screen.getByRole('region', { name: 'Ledger overview' });
    expect(within(overview).getByText('0', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText(/No integrity failures were found/)).toBeTruthy();
  });

  it('shows an integrity failure, its count and the block involved after a failed check', async () => {
    historyService.verifyLedger.mockResolvedValue(invalidResult());
    render(<LedgerAudit />);
    await screen.findByRole('region', { name: 'Ledger overview' });

    fireEvent.click(screen.getByRole('button', { name: 'Verify ledger' }));

    await waitFor(() => expect(document.querySelector('.ledger-overview__verdict--invalid')?.textContent).toBe('Invalid'));
    expect(screen.getByText(/Integrity failure detected: 1 failure found/)).toBeTruthy();
    expect(screen.getByText(/Verification does not repair or change any record/)).toBeTruthy();
    expect(screen.getByText('Block 2', { selector: 'strong' })).toBeTruthy();
  });

  it('shows a loading state, then an error state when the ledger cannot be loaded', async () => {
    ledgerService.fetchLedger.mockRejectedValue(new Error('Network error'));
    render(<LedgerAudit />);

    expect(await screen.findByText('The ledger overview could not be loaded. Make sure the backend is running.')).toBeTruthy();
  });

  it('shows an empty state when the ledger has no blocks', async () => {
    ledgerService.fetchLedger.mockResolvedValue(ledgerBody([]));
    render(<LedgerAudit />);

    expect(await screen.findByText('The ledger has no blocks.')).toBeTruthy();
  });
});

describe('LedgerAudit block details', () => {
  beforeEach(() => {
    ledgerService.fetchLedger.mockResolvedValue(ledgerBody(BLOCKS));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete navigator.clipboard;
  });

  it('opens the details of a block with what was recorded, when, for which batch and by whom', async () => {
    render(<LedgerAudit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for block 2' }));

    const detail = await screen.findByRole('region', { name: 'Block 2 details' });
    expect(within(detail).getByText('Shipment updated')).toBeTruthy();
    expect(within(detail).getByText('PB-7K2M-9QXD', { selector: 'code' })).toBeTruthy();
    expect(within(detail).getByText('Distributor')).toBeTruthy();
    expect(within(detail).getByText('Left the farm')).toBeTruthy();
    expect(within(detail).getByText('Shipped')).toBeTruthy();
  });

  it('explains how the block links to the block before it', async () => {
    render(<LedgerAudit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for block 2' }));

    expect(await screen.findByText('Its previous hash matches the block hash stored in block 1.')).toBeTruthy();
  });

  it('says when the stored link does not match the block before it', async () => {
    const broken = { ...SHIPMENT, previous_hash: 'f'.repeat(64) };
    ledgerService.fetchLedger.mockResolvedValue(ledgerBody([GENESIS, REGISTRATION, broken]));
    render(<LedgerAudit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for block 2' }));

    expect(await screen.findByText(/does not match the block hash stored in block 1/)).toBeTruthy();
  });

  it('describes the genesis block without an earlier block', async () => {
    render(<LedgerAudit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for block 0' }));

    expect(await screen.findByText(/This is the genesis block/)).toBeTruthy();
    expect(screen.getByText('None (genesis block)')).toBeTruthy();
  });

  it('shows the full previous and current hashes and copies them with feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<LedgerAudit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for block 2' }));

    const detail = await screen.findByRole('region', { name: 'Block 2 details' });
    expect(within(detail).getByText(SHIPMENT.previous_hash)).toBeTruthy();
    expect(within(detail).getByText(SHIPMENT.block_hash)).toBeTruthy();

    fireEvent.click(within(detail).getByRole('button', { name: 'Copy details: block hash of block 2' }));

    expect(await within(detail).findByText('Copied')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(SHIPMENT.block_hash);
  });

  it('moves between neighbouring blocks and disables the buttons at either end', async () => {
    render(<LedgerAudit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for block 1' }));
    await screen.findByRole('region', { name: 'Block 1 details' });

    fireEvent.click(screen.getByRole('button', { name: 'Show block 2' }));
    expect(await screen.findByRole('region', { name: 'Block 2 details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No later block' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Show block 1' }));
    await screen.findByRole('region', { name: 'Block 1 details' });
    fireEvent.click(screen.getByRole('button', { name: 'Show block 0' }));
    expect(await screen.findByRole('region', { name: 'Block 0 details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No earlier block' }).disabled).toBe(true);
  });

  it('never shows a private account, password or session field', async () => {
    render(<LedgerAudit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for block 2' }));
    await screen.findByRole('region', { name: 'Block 2 details' });

    const text = document.querySelector('.ledger-detail').textContent;
    expect(text).not.toMatch(/password|username|session|created_by|user_id/i);
  });
});
