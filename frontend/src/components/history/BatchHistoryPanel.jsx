import { useState } from 'react';
import { ApiError } from '../../services/apiClient.js';
import { fetchBatchHistory } from '../../services/historyService.js';
import { formatTimestamp } from '../batches/batchFormatters.js';

const BATCH_ID_PATTERN = /^PB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const NETWORK_ERROR = 'Could not reach the server. Make sure the backend is running, then try again.';
const LOAD_ERROR = 'The batch history could not be loaded. Please try again.';

const KIND_CLASSES = {
  PRODUCT_REGISTERED: 'history-badge--registration',
  SHIPMENT_UPDATED: 'history-badge--shipment',
  RECEIPT_CONFIRMED: 'history-badge--receipt',
};

/**
 * Chronological history of one batch: registration, shipment and receipt events, each with its actor,
 * status, optional note, timestamp and the ledger block that records it. Available to every role.
 */
export default function BatchHistoryPanel() {
  const [batchId, setBatchId] = useState('');
  const [inputError, setInputError] = useState(null);
  const [state, setState] = useState({ status: 'idle', history: null, error: null, searchedId: '' });

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = batchId.trim().toUpperCase();
    if (!BATCH_ID_PATTERN.test(trimmed)) {
      setInputError('Enter a batch ID such as PB-7K2M-9QXD.');
      document.getElementById('batch-history-id')?.focus();
      return;
    }
    setInputError(null);
    setState({ status: 'loading', history: null, error: null, searchedId: trimmed });
    try {
      const history = await fetchBatchHistory(trimmed);
      setState({ status: 'ready', history, error: null, searchedId: trimmed });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'not-found', history: null, error: null, searchedId: trimmed });
      } else if (error instanceof ApiError && error.status === undefined) {
        setState({ status: 'error', history: null, error: NETWORK_ERROR, searchedId: trimmed });
      } else {
        setState({ status: 'error', history: null, error: LOAD_ERROR, searchedId: trimmed });
      }
    }
  }

  return (
    <section className="workspace-card history-panel" aria-labelledby="batch-history-heading">
      <h2 id="batch-history-heading" className="dashboard__section-heading">
        Batch history
      </h2>
      <p className="ledger__intro">Enter a batch ID to see its registration, shipment and receipt events in order.</p>

      <form className="history-form" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="batch-history-id">Batch ID</label>
          <input
            id="batch-history-id"
            type="text"
            autoComplete="off"
            placeholder="PB-XXXX-XXXX"
            value={batchId}
            aria-invalid={inputError ? 'true' : 'false'}
            aria-describedby={inputError ? 'batch-history-id-error' : undefined}
            onChange={(event) => setBatchId(event.target.value)}
          />
          {inputError ? (
            <p id="batch-history-id-error" className="field-error">
              {inputError}
            </p>
          ) : null}
        </div>
        <button type="submit" className="btn btn--primary" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Loading…' : 'Show history'}
        </button>
      </form>

      {state.status === 'loading' ? <p role="status">Loading history for {state.searchedId}…</p> : null}
      {state.status === 'not-found' ? (
        <div className="alert alert--danger" role="alert">
          No batch has the ID {state.searchedId}.
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="alert alert--danger" role="alert">
          {state.error}
        </div>
      ) : null}

      {state.status === 'ready' && state.history ? <HistoryResult history={state.history} /> : null}
    </section>
  );
}

function HistoryResult({ history }) {
  const { batch, events } = history;

  return (
    <div className="history-result">
      <p className="history-summary">
        <code className="batch-id">{batch.batch_id}</code> {batch.product_name}, currently{' '}
        <strong>{batch.current_status}</strong>
      </p>

      {events.length === 0 ? (
        <p className="batch-list__empty">No events are recorded for this batch yet.</p>
      ) : (
        <ol className="history-list" aria-label={`History of batch ${batch.batch_id}`}>
          {events.map((event) => (
            <li key={event.event_id} className="history-item" data-event-type={event.event_type}>
              <div className="history-item__head">
                <span className={`history-badge ${KIND_CLASSES[event.event_type] ?? ''}`}>{event.label}</span>
                <time dateTime={event.timestamp} className="history-item__time">
                  {formatTimestamp(event.timestamp)}
                </time>
              </div>
              <dl className="history-item__details">
                <div>
                  <dt>Actor</dt>
                  <dd>{event.actor_role}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{event.status}</dd>
                </div>
                <div>
                  <dt>Note</dt>
                  <dd>{event.note || 'No note'}</dd>
                </div>
                <div>
                  <dt>Ledger block</dt>
                  <dd>{event.ledger_block_index === null ? 'Not in the ledger' : `Block ${event.ledger_block_index}`}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
