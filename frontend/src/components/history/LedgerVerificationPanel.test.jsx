// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../services/apiClient.js';
import * as historyService from '../../services/historyService.js';
import LedgerVerificationPanel from './LedgerVerificationPanel.jsx';

vi.mock('../../services/historyService.js', () => ({
  fetchBatchHistory: vi.fn(),
  verifyLedger: vi.fn(),
}));

const CHECKS = [
  { id: 'genesis', label: 'Genesis block', passed: true },
  { id: 'sequence', label: 'Sequential block indexes', passed: true },
  { id: 'canonical_data', label: 'Canonical event data', passed: true },
  { id: 'timestamps', label: 'Timestamp format', passed: true },
  { id: 'hash_format', label: 'Hash format', passed: true },
  { id: 'previous_hash_links', label: 'Previous-hash links', passed: true },
  { id: 'block_hashes', label: 'Block hashes recalculated', passed: true },
  { id: 'event_references', label: 'Event references', passed: true },
  { id: 'event_coverage', label: 'Every supported event has a block', passed: true },
];

const VALID = {
  result: 'valid',
  checked_blocks: 5,
  latest_block_index: 4,
  recalculated_latest_hash: 'a'.repeat(64),
  first_failing_block: null,
  checks: CHECKS,
  failures: [],
  verified_at: '2026-11-26T18:00:00.000Z',
};

const INVALID = {
  ...VALID,
  result: 'invalid',
  first_failing_block: 2,
  checks: CHECKS.map((check) => (check.id === 'block_hashes' ? { ...check, passed: false } : check)),
  failures: [
    {
      block_index: 2,
      check: 'block_hashes',
      reason: 'The stored block hash f does not match the recalculated hash e. The block contents or link have changed.',
    },
    {
      block_index: 3,
      check: 'previous_hash_links',
      reason: 'Block 3 stores previous hash x, but the recalculated hash of block 2 is e.',
    },
  ],
};

function verify() {
  fireEvent.click(screen.getByRole('button', { name: 'Verify ledger' }));
}

describe('LedgerVerificationPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the explanation and the verify action without running the check', () => {
    render(<LedgerVerificationPanel />);

    expect(screen.getByRole('heading', { name: 'Ledger integrity' })).toBeTruthy();
    expect(screen.getByText(/Nothing is changed by this check/)).toBeTruthy();
    expect(historyService.verifyLedger).not.toHaveBeenCalled();
    expect(screen.queryByText('Valid')).toBeNull();
    expect(screen.queryByText('Invalid')).toBeNull();
  });

  it('shows a verifying state and does not show a result before the backend answers', async () => {
    let finish;
    historyService.verifyLedger.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<LedgerVerificationPanel />);

    verify();

    expect(screen.getByRole('status').textContent).toBe('Recalculating every block hash…');
    expect(screen.getByRole('button', { name: 'Verifying…' }).disabled).toBe(true);
    expect(screen.queryByText('Valid')).toBeNull();

    finish(VALID);
    expect(await screen.findByText('Valid')).toBeTruthy();
  });

  it('displays a Valid result with the checks and details', async () => {
    historyService.verifyLedger.mockResolvedValue(VALID);
    render(<LedgerVerificationPanel />);

    verify();

    const verdict = await screen.findByText('Valid');
    expect(verdict.closest('.verdict').textContent).toContain('All 5 blocks passed every check.');
    expect(screen.getByText('Block 4')).toBeTruthy();
    expect(screen.getByText('a'.repeat(64))).toBeTruthy();
    const checks = document.querySelector('.verification-checks');
    expect(within(checks).getAllByText('Passed')).toHaveLength(CHECKS.length);
    expect(screen.queryByText('Failures')).toBeNull();
  });

  it('displays an Invalid result, the failing block and the reasons', async () => {
    historyService.verifyLedger.mockResolvedValue(INVALID);
    render(<LedgerVerificationPanel />);

    verify();

    expect(await screen.findByText('Invalid')).toBeTruthy();
    const verdict = screen.getByText('Invalid').closest('.verdict');
    expect(verdict.getAttribute('role')).toBe('alert');
    expect(verdict.textContent).toContain('The first failing block is block 2.');
    expect(screen.getByText('Failures')).toBeTruthy();
    expect(screen.getByText('The stored block hash f does not match the recalculated hash e. The block contents or link have changed.')).toBeTruthy();
    expect(screen.getByText('Block 3 stores previous hash x, but the recalculated hash of block 2 is e.')).toBeTruthy();
    expect(screen.getByText('Block hashes recalculated', { selector: 'span' }).parentElement.textContent).toContain('Failed');
  });

  it('labels a ledger-wide failure without a block number', async () => {
    historyService.verifyLedger.mockResolvedValue({
      ...VALID,
      result: 'invalid',
      checks: CHECKS.map((check) => (check.id === 'event_coverage' ? { ...check, passed: false } : check)),
      failures: [{ block_index: null, check: 'event_coverage', reason: 'Supported event 7 (SHIPMENT_UPDATED) has no ledger block.' }],
    });
    render(<LedgerVerificationPanel />);

    verify();

    expect(await screen.findByText('Ledger-wide')).toBeTruthy();
    expect(screen.getByText('Supported event 7 (SHIPMENT_UPDATED) has no ledger block.')).toBeTruthy();
  });

  it('shows an error when the verification request fails on the server', async () => {
    historyService.verifyLedger.mockRejectedValue(new ApiError('Request failed with status 500.', { status: 500 }));
    render(<LedgerVerificationPanel />);

    verify();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Verification could not be completed. Please try again.');
    expect(screen.queryByText('Valid')).toBeNull();
    expect(screen.queryByText('Invalid')).toBeNull();
  });

  it('shows a network message when the server cannot be reached', async () => {
    historyService.verifyLedger.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<LedgerVerificationPanel />);

    verify();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Make sure the backend is running'));
  });
});
