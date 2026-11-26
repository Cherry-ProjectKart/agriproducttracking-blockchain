import { useCallback, useEffect, useState } from 'react';
import { fetchLedger } from '../../services/ledgerService.js';
import { formatTimestamp } from '../batches/batchFormatters.js';

const LOAD_ERROR = 'Could not load the ledger. Make sure the backend is running.';

const EVENT_LABELS = {
  GENESIS: 'Ledger start',
  PRODUCT_REGISTERED: 'Product registered',
  SHIPMENT_UPDATED: 'Shipment updated',
  RECEIPT_CONFIRMED: 'Receipt confirmed',
};

/**
 * Read-only view of the local hash-linked ledger (US-04). Each block shows its index, time,
 * event, batch ID and the two SHA-256 hashes that link it to the chain.
 */
export default function LedgerView() {
  const [state, setState] = useState({ status: 'loading', blocks: [] });

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
                    <code className="hash" title={block.previous_hash}>
                      {block.previous_hash}
                    </code>
                  </td>
                  <td>
                    <code className="hash" title={block.block_hash}>
                      {block.block_hash}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
