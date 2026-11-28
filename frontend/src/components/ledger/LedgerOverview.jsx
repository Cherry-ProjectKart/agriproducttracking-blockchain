import { useEffect, useState } from 'react';
import { fetchLedger } from '../../services/ledgerService.js';
import { formatTimestamp } from '../batches/batchFormatters.js';
import { shortHash } from '../../utils/ledgerDisplay.js';

const LOAD_ERROR = 'The ledger overview could not be loaded. Make sure the backend is running.';

/**
 * Statistics for the ledger, taken from the blocks the ledger API returns. Nothing here is typed in: the
 * block count, latest block, event count and genesis block all come from the stored chain. The verification
 * status is the result of the last integrity check run in this view, or "Not checked yet".
 */
export default function LedgerOverview({ verification = null }) {
  const [state, setState] = useState({ status: 'loading', blocks: [], count: 0, latest: null });

  useEffect(() => {
    const controller = new AbortController();
    fetchLedger({ signal: controller.signal })
      .then((body) => setState({ status: 'ready', blocks: body.blocks, count: body.count, latest: body.latest }))
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState({ status: 'error', blocks: [], count: 0, latest: null });
      });
    return () => controller.abort();
  }, []);

  if (state.status === 'loading') {
    return (
      <section className="workspace-card ledger-overview" aria-labelledby="ledger-overview-heading">
        <h2 id="ledger-overview-heading" className="dashboard__section-heading">
          Ledger overview
        </h2>
        <p role="status">Loading the ledger overview…</p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="workspace-card ledger-overview" aria-labelledby="ledger-overview-heading">
        <h2 id="ledger-overview-heading" className="dashboard__section-heading">
          Ledger overview
        </h2>
        <div className="alert alert--danger" role="alert">
          {LOAD_ERROR}
        </div>
      </section>
    );
  }

  const { blocks } = state;
  const latest = state.latest ?? blocks[blocks.length - 1] ?? null;
  const genesis = blocks.find((block) => block.index === 0) ?? null;
  const recordedEvents = blocks.filter((block) => block.event_id !== null && block.event_id !== undefined).length;

  let verificationText = 'Not checked yet. Run the integrity check below.';
  if (verification) {
    verificationText = verification.result === 'valid' ? 'Valid' : 'Invalid';
  }
  const failureText = verification ? String(verification.failures.length) : 'Not checked yet';

  return (
    <section className="workspace-card ledger-overview" aria-labelledby="ledger-overview-heading">
      <h2 id="ledger-overview-heading" className="dashboard__section-heading">
        Ledger overview
      </h2>

      {blocks.length === 0 ? (
        <p className="batch-list__empty">The ledger has no blocks.</p>
      ) : (
        <dl className="ledger-overview__stats">
          <div>
            <dt>Blocks in the chain</dt>
            <dd data-testid="ledger-block-count">{state.count}</dd>
          </div>
          <div>
            <dt>Latest block</dt>
            <dd>
              {latest ? `Block ${latest.index}` : 'None'}
              {latest ? (
                <span className="ledger-overview__sub">
                  <time dateTime={latest.timestamp}>{formatTimestamp(latest.timestamp)}</time>
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Recorded events</dt>
            <dd>{recordedEvents}</dd>
          </div>
          <div>
            <dt>Genesis block</dt>
            <dd>
              {genesis ? `Block 0 · ${formatTimestamp(genesis.timestamp)}` : 'Not found'}
              {genesis ? (
                <span className="ledger-overview__sub">
                  <code className="hash" title={genesis.block_hash}>
                    {shortHash(genesis.block_hash)}
                  </code>
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Chain verification</dt>
            <dd>
              <span
                className={
                  verification
                    ? `ledger-overview__verdict ledger-overview__verdict--${verification.result === 'valid' ? 'valid' : 'invalid'}`
                    : 'ledger-overview__verdict'
                }
              >
                {verificationText}
              </span>
            </dd>
          </div>
          <div>
            <dt>Integrity failures found</dt>
            <dd>{failureText}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
