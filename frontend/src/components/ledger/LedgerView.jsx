import { useCallback, useEffect, useState } from 'react';
import { fetchLedger } from '../../services/ledgerService.js';
import { formatTimestamp } from '../batches/batchFormatters.js';
import { copyText } from '../../utils/clipboard.js';
import { EVENT_LABELS } from '../../utils/ledgerDisplay.js';
import LedgerBlockDetail from './LedgerBlockDetail.jsx';

const LOAD_ERROR = 'Could not load the ledger. Make sure the backend is running.';

/** One full hash, shown in full with a copy button so it can be compared with another record. */
function HashCell({ value, label }) {
  const [message, setMessage] = useState(null);

  async function copy() {
    const copied = await copyText(value);
    setMessage(copied ? 'Copied' : 'Copy failed');
  }

  return (
    <div className="hash-cell">
      <code className="hash">{value}</code>
      <div className="hash-cell__actions">
        <button type="button" className="btn btn--small btn--secondary" onClick={copy} aria-label={`Copy ${label}`}>
          Copy
        </button>
        {message ? <span role="status" className="hash-cell__message">{message}</span> : null}
      </div>
    </div>
  );
}

/**
 * Read-only view of the local hash-linked ledger (US-04). Each block shows its index, time,
 * event, batch ID and the two SHA-256 hashes that link it to the chain.
 */
export default function LedgerView() {
  const [state, setState] = useState({ status: 'loading', blocks: [] });
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (signal) => {
    setState((current) => ({ ...current, status: 'loading' }));
    try {
      const body = await fetchLedger({ signal });
      setState({ status: 'ready', blocks: body.blocks });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setState({ status: 'error', blocks: [] });
    }
  }, []);

  const selectedPosition = selected === null ? -1 : state.blocks.findIndex((block) => block.index === selected);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <section className="workspace-card ledger" aria-labelledby="ledger-heading">
      <h2 id="ledger-heading" className="dashboard__section-heading">
        Local ledger
      </h2>
      <p className="ledger__intro">
        Each block stores the SHA-256 hash of its contents and the hash of the block before it. If a stored
        block were changed, its hash would no longer match the next block. This shows tampering. It does
        not prove that the recorded facts are true.
      </p>

      {state.status === 'loading' ? <p role="status">Loading ledger…</p> : null}
      {state.status === 'error' ? (
        <div className="alert alert--danger" role="alert">
          <p>{LOAD_ERROR}</p>
          <button type="button" className="btn btn--secondary" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : null}
      {state.status === 'ready' && state.blocks.length === 0 ? <p>The ledger is empty.</p> : null}
      {state.status === 'ready' && state.blocks.length > 0 ? (
        <p className="ledger__count">Blocks in the chain: {state.blocks.length}</p>
      ) : null}
      {state.status === 'ready' && state.blocks.length > 0 ? (
        <div className="table-wrapper">
          <table className="ledger-table">
            <caption className="visually-hidden">Ledger blocks in order</caption>
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col">Timestamp (UTC)</th>
                <th scope="col">Event</th>
                <th scope="col">Batch ID</th>
                <th scope="col">Previous hash</th>
                <th scope="col">Block hash</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {state.blocks.map((block) => (
                <tr key={block.index}>
                  <td>{block.index}</td>
                  <td>{formatTimestamp(block.timestamp)}</td>
                  <td>{EVENT_LABELS[block.event_type] ?? block.event_type}</td>
                  <td>{block.batch_id ? <code className="batch-id">{block.batch_id}</code> : '—'}</td>
                  <td>
                    <HashCell value={block.previous_hash} label={`previous hash of block ${block.index}`} />
                  </td>
                  <td>
                    <HashCell value={block.block_hash} label={`block hash of block ${block.index}`} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--small btn--secondary"
                      onClick={() => setSelected(block.index)}
                      aria-label={`Show details for block ${block.index}`}
                      aria-pressed={selected === block.index}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {state.status === 'ready' && selectedPosition >= 0 ? (
        <LedgerBlockDetail
          block={state.blocks[selectedPosition]}
          previousBlock={selectedPosition > 0 ? state.blocks[selectedPosition - 1] : null}
          nextBlock={selectedPosition < state.blocks.length - 1 ? state.blocks[selectedPosition + 1] : null}
          onSelect={setSelected}
        />
      ) : null}
    </section>
  );
}
