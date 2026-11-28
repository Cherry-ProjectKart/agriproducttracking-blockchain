import { useState } from 'react';
import { ApiError } from '../../services/apiClient.js';
import { verifyLedger } from '../../services/historyService.js';
import { formatTimestamp } from '../batches/batchFormatters.js';

const NETWORK_ERROR = 'Verification could not be completed. Make sure the backend is running, then try again.';
const SERVER_ERROR = 'Verification could not be completed. Please try again.';

/**
 * Runs the independent ledger check on the server and shows the outcome. Valid or Invalid is shown only
 * after the backend has returned its result. Verification changes nothing.
 */
export default function LedgerVerificationPanel({ onResult = null }) {
  const [state, setState] = useState({ status: 'idle', result: null, error: null });

  async function handleVerify() {
    setState({ status: 'verifying', result: null, error: null });
    try {
      const result = await verifyLedger();
      setState({ status: 'done', result, error: null });
      onResult?.(result);
    } catch (error) {
      const message = error instanceof ApiError && error.status === undefined ? NETWORK_ERROR : SERVER_ERROR;
      setState({ status: 'error', result: null, error: message });
    }
  }

  return (
    <section className="workspace-card verification-panel" aria-labelledby="ledger-integrity-heading">
      <h2 id="ledger-integrity-heading" className="dashboard__section-heading">
        Ledger integrity
      </h2>
      <p className="ledger__intro">
        Recalculates the SHA-256 hash of every block from its stored contents and checks each link to the block before
        it. Nothing is changed by this check.
      </p>

      <button type="button" className="btn btn--primary" onClick={handleVerify} disabled={state.status === 'verifying'}>
        {state.status === 'verifying' ? 'Verifying…' : 'Verify ledger'}
      </button>

      {state.status === 'verifying' ? <p role="status">Recalculating every block hash…</p> : null}
      {state.status === 'error' ? (
        <div className="alert alert--danger" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.status === 'done' && state.result ? <VerificationResult result={state.result} /> : null}
    </section>
  );
}

const FAILURE_SUBJECT = (index) => (index === null || index === undefined ? 'Ledger-wide' : `Block ${index}`);

function VerificationResult({ result }) {
  const valid = result.result === 'valid';

  return (
    <div className="verification-result">
      {valid ? (
        <div className="verdict verdict--valid" role="status">
          <strong>Valid</strong> All {result.checked_blocks} blocks passed every check. No integrity failures were found.
        </div>
      ) : (
        <div className="verdict verdict--invalid" role="alert">
          <strong>Invalid</strong> Integrity failure detected: {result.failures.length} failure{result.failures.length === 1 ? '' : 's'} found.
          {result.first_failing_block !== null ? ` The first failing block is block ${result.first_failing_block}.` : ''}
          <span className="verdict__note"> Verification does not repair or change any record.</span>
        </div>
      )}

      <dl className="batch-details__list verification-details">
        <div>
          <dt>Blocks checked</dt>
          <dd>{result.checked_blocks}</dd>
        </div>
        <div>
          <dt>Latest block</dt>
          <dd>{result.latest_block_index === null ? 'None' : `Block ${result.latest_block_index}`}</dd>
        </div>
        <div>
          <dt>Recalculated latest hash</dt>
          <dd>
            <code className="hash">{result.recalculated_latest_hash ?? 'Not available'}</code>
          </dd>
        </div>
        <div>
          <dt>Verified at</dt>
          <dd>{formatTimestamp(result.verified_at)}</dd>
        </div>
      </dl>

      <h3 className="verification-subheading">Checks</h3>
      <ul className="verification-checks">
        {result.checks.map((check) => (
          <li key={check.id} className={check.passed ? 'check--passed' : 'check--failed'}>
            <span>{check.label}</span>
            <span className="check-outcome">{check.passed ? 'Passed' : 'Failed'}</span>
          </li>
        ))}
      </ul>

      {result.failures.length > 0 ? (
        <>
          <h3 className="verification-subheading">Failures</h3>
          <ul className="verification-failures">
            {result.failures.map((failure, position) => (
              <li key={`${failure.check}-${failure.block_index}-${position}`}>
                <strong>{FAILURE_SUBJECT(failure.block_index)}</strong>
                <span className="failure-check"> ({failure.check.replaceAll('_', ' ')})</span>
                <p className="failure-reason">{failure.reason}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
