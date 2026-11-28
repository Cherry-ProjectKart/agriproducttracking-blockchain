import { useCallback, useEffect, useState } from 'react';
import WorkspaceSummary from '../WorkspaceSummary.jsx';
import BatchHistoryPanel from '../history/BatchHistoryPanel.jsx';
import { ApiError } from '../../services/apiClient.js';
import { createSubmissionKey } from '../../services/batchService.js';
import { confirmReceipt, fetchAwaitingReceipts, fetchReceivedReceipts } from '../../services/receiptService.js';
import { formatQuantity, formatTimestamp } from '../batches/batchFormatters.js';
import { shipmentStatusModifier } from '../../utils/shipmentValidation.js';

const LIST_ERROR = 'Could not load the batches. Make sure the backend is running.';
const NETWORK_ERROR = 'Could not reach the server. The receipt was not confirmed; try again.';
const GENERIC_ERROR = 'The receipt could not be confirmed. Please try again.';
const NOT_SELECTED = 'Select a batch to confirm.';

function messageFrom(error) {
  if (error instanceof ApiError && error.body?.error?.message) return error.body.error.message;
  if (error instanceof ApiError && error.status === undefined) return NETWORK_ERROR;
  return GENERIC_ERROR;
}

function StatusPill({ status }) {
  return (
    <span className={`shipment-status-pill shipment-status-pill--${shipmentStatusModifier(status)}`}>{status}</span>
  );
}

/**
 * Retailer workspace: batches awaiting receipt, their details and movement history, and the final
 * handover confirmation. A batch is listed here only once the distributor has delivered it to the
 * retailer. Confirming moves it to "Received by Retailer" and it appears in the received list.
 * Rendered only for the retailer role.
 */
export default function RetailerReceiptPanel() {
  const [awaiting, setAwaiting] = useState({ status: 'loading', batches: [] });
  const [received, setReceived] = useState({ status: 'loading', batches: [] });
  const [selectedId, setSelectedId] = useState('');
  const [selectionError, setSelectionError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [submissionKey, setSubmissionKey] = useState(createSubmissionKey);
  const [historyRequest, setHistoryRequest] = useState(null);

  const loadAwaiting = useCallback(async (signal) => {
    setAwaiting((current) => ({ ...current, status: 'loading' }));
    try {
      const batches = await fetchAwaitingReceipts({ signal });
      setAwaiting({ status: 'ready', batches });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setAwaiting({ status: 'error', batches: [] });
    }
  }, []);

  const loadReceived = useCallback(async (signal) => {
    setReceived((current) => ({ ...current, status: 'loading' }));
    try {
      const batches = await fetchReceivedReceipts({ signal });
      setReceived({ status: 'ready', batches });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setReceived({ status: 'error', batches: [] });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadAwaiting(controller.signal);
    loadReceived(controller.signal);
    return () => controller.abort();
  }, [loadAwaiting, loadReceived]);

  const selected = awaiting.batches.find((batch) => batch.batch_id === selectedId) ?? null;

  function chooseBatch(batch) {
    setSelectedId(batch.batch_id);
    setSelectionError(null);
    setFormError(null);
    setConfirming(false);
    setConfirmed(null);
    setHistoryRequest((previous) => ({ batchId: batch.batch_id, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  function requestConfirmation(event) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    setConfirmed(null);
    if (!selected) {
      setSelectionError(NOT_SELECTED);
      document.getElementById('receipt-batch-table')?.focus();
      return;
    }
    setSelectionError(null);
    setConfirming(true);
  }

  async function confirmAndRecord() {
    if (submitting || !selected) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await confirmReceipt(selected.batch_id, submissionKey);
      setConfirmed(result);
      setConfirming(false);
      setSelectedId('');
      setSubmissionKey(createSubmissionKey());
      setHistoryRequest((previous) => ({ batchId: result.batch.batch_id, nonce: (previous?.nonce ?? 0) + 1 }));
      await Promise.all([loadAwaiting(), loadReceived()]);
    } catch (error) {
      setConfirming(false);
      setFormError(messageFrom(error));
      // A conflict usually means the batch was already received elsewhere: reload so the lists are current.
      if (error instanceof ApiError && error.status === 409) {
        setSelectedId('');
        await Promise.all([loadAwaiting(), loadReceived()]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const awaitingCount = awaiting.batches.length;

  return (
    <div className="receipt-panel">
      <section className="workspace-card" aria-labelledby="receipt-batches-heading">
        <h2 id="receipt-batches-heading" className="dashboard__section-heading">
          Incoming shipments awaiting receipt
        </h2>
        <p className="batch-form__hint">
          Only batches the distributor has marked <strong>Delivered to Retailer</strong> can be received here.
          Earlier stages of a shipment are not listed.
        </p>

        {awaiting.status === 'loading' ? <p role="status">Loading batches…</p> : null}
        {awaiting.status === 'error' ? (
          <div className="alert alert--danger" role="alert">
            {LIST_ERROR}
          </div>
        ) : null}
        {awaiting.status === 'ready' && awaitingCount === 0 ? (
          <p className="batch-list__empty">No batches are awaiting receipt right now.</p>
        ) : null}
        {awaiting.status === 'ready' && awaitingCount > 0 ? (
          <WorkspaceSummary label="Receipt summary" items={[{ label: 'Awaiting receipt', value: awaitingCount }]} />
        ) : null}
        {awaiting.status === 'ready' && awaitingCount > 0 ? (
          <fieldset className="shipment-select" aria-describedby={selectionError ? 'receipt-selection-error' : undefined}>
            <legend className="visually-hidden">Select a batch to receive</legend>
            <div className="table-wrapper">
              <table id="receipt-batch-table" className="batch-table" tabIndex={-1}>
                <caption className="visually-hidden">Batches awaiting receipt by the retailer</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="visually-hidden">Select</span></th>
                    <th scope="col">Batch ID</th>
                    <th scope="col">Product</th>
                    <th scope="col">Origin</th>
                    <th scope="col">Quantity</th>
                    <th scope="col">Current status</th>
                    <th scope="col">Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {awaiting.batches.map((batch) => (
                    <tr key={batch.batch_id} className={batch.batch_id === selectedId ? 'batch-table__row--selected' : undefined}>
                      <td>
                        <input
                          type="radio"
                          name="receipt-batch"
                          value={batch.batch_id}
                          checked={batch.batch_id === selectedId}
                          onChange={() => chooseBatch(batch)}
                          aria-label={`Select batch ${batch.batch_id}`}
                        />
                      </td>
                      <td>
                        <code className="batch-id">{batch.batch_id}</code>
                      </td>
                      <td>{batch.product_name}</td>
                      <td>{batch.origin}</td>
                      <td>{formatQuantity(batch.quantity, batch.unit)}</td>
                      <td>
                        <StatusPill status={batch.current_status} />
                      </td>
                      <td>{batch.delivered_at ? formatTimestamp(batch.delivered_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectionError ? (
              <p id="receipt-selection-error" className="field-error">
                {selectionError}
              </p>
            ) : null}
          </fieldset>
        ) : null}
      </section>

      {selected ? (
        <section className="workspace-card" aria-labelledby="receipt-details-heading">
          <h2 id="receipt-details-heading" className="dashboard__section-heading">
            Batch details
          </h2>
          <dl className="batch-details__list">
            <div>
              <dt>Batch ID</dt>
              <dd>
                <code className="batch-id">{selected.batch_id}</code>
              </dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd>{selected.product_name}</dd>
            </div>
            <div>
              <dt>Origin</dt>
              <dd>{selected.origin}</dd>
            </div>
            <div>
              <dt>Quantity</dt>
              <dd>{formatQuantity(selected.quantity, selected.unit)}</dd>
            </div>
            <div>
              <dt>Harvest date</dt>
              <dd>{selected.harvest_date}</dd>
            </div>
            <div>
              <dt>Delivered to retailer</dt>
              <dd>{selected.delivered_at ? formatTimestamp(selected.delivered_at) : 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Current status</dt>
              <dd>
                <StatusPill status={selected.current_status} />
              </dd>
            </div>
          </dl>
          <p className="shipment-track-link">
            <a href={`/track/${selected.batch_id}`} target="_blank" rel="noopener noreferrer">
              Open the public tracking page for {selected.batch_id}
            </a>
          </p>
        </section>
      ) : null}

      {historyRequest ? (
        <section className="workspace-card" aria-labelledby="receipt-history-heading">
          <h2 id="receipt-history-heading" className="dashboard__section-heading">
            Shipment and receipt history
          </h2>
          <BatchHistoryPanel request={historyRequest} />
        </section>
      ) : null}

      {awaiting.status === 'ready' && awaitingCount > 0 ? (
        <section className="workspace-card" aria-labelledby="receipt-confirm-heading">
          <h2 id="receipt-confirm-heading" className="dashboard__section-heading">
            Confirm final handover
          </h2>
          {selected ? (
            <p className="shipment-selected">
              You are confirming the handover of <code className="batch-id">{selected.batch_id}</code>{' '}
              {selected.product_name}. Its status will change from <strong>{selected.current_status}</strong> to{' '}
              <strong>Received by Retailer</strong>.
            </p>
          ) : (
            <p className="shipment-selected">Select a batch above to confirm its handover.</p>
          )}

          <form className="batch-form" onSubmit={requestConfirmation} noValidate aria-busy={submitting}>
            {formError ? (
              <div className="alert alert--danger" role="alert">
                {formError}
              </div>
            ) : null}
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                Confirm receipt
              </button>
            </div>
          </form>

          {confirming && selected ? (
            <div className="shipment-confirm" role="group" aria-labelledby="receipt-confirm-dialog-heading">
              <h3 id="receipt-confirm-dialog-heading">Confirm receipt of this batch</h3>
              <p>
                Confirm the final handover of <code className="batch-id">{selected.batch_id}</code> to the retailer. This
                is recorded on the ledger and cannot be undone.
              </p>
              <div className="form-actions">
                <button type="button" className="btn btn--primary" onClick={confirmAndRecord} disabled={submitting}>
                  {submitting ? 'Recording…' : 'Confirm handover'}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)} disabled={submitting}>
                  Cancel
                </button>
              </div>
              {submitting ? (
                <span role="status" className="form-status">
                  Recording the receipt…
                </span>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {confirmed ? (
        <section className="workspace-card" aria-labelledby="receipt-saved-heading">
          <div className="alert alert--success" role="status">
            <strong id="receipt-saved-heading">Receipt confirmed.</strong>{' '}
            <code className="batch-id">{confirmed.batch.batch_id}</code> is now{' '}
            <strong>{confirmed.batch.current_status}</strong>. Received at {formatTimestamp(confirmed.event.timestamp)}.
            Recorded in the ledger as block {confirmed.ledger_block.index}.
          </div>
          <dl className="batch-details__list">
            <div>
              <dt>Event</dt>
              <dd>{confirmed.event.event_type}</dd>
            </div>
            <div>
              <dt>Received at</dt>
              <dd>{formatTimestamp(confirmed.event.timestamp)}</dd>
            </div>
            <div>
              <dt>Block hash</dt>
              <dd>
                <code className="hash">{confirmed.ledger_block.block_hash}</code>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="workspace-card" aria-labelledby="received-heading">
        <h2 id="received-heading" className="dashboard__section-heading">
          Received batches
        </h2>
        {received.status === 'loading' ? <p role="status">Loading received batches…</p> : null}
        {received.status === 'error' ? (
          <div className="alert alert--danger" role="alert">
            {LIST_ERROR}
          </div>
        ) : null}
        {received.status === 'ready' && received.batches.length === 0 ? (
          <p className="batch-list__empty">No batches have been received yet.</p>
        ) : null}
        {received.status === 'ready' && received.batches.length > 0 ? (
          <div className="table-wrapper">
            <table className="batch-table">
              <caption className="visually-hidden">Batches already received by a retailer</caption>
              <thead>
                <tr>
                  <th scope="col">Batch ID</th>
                  <th scope="col">Product</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Received</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {received.batches.map((batch) => (
                  <tr key={batch.batch_id}>
                    <td>
                      <code className="batch-id">{batch.batch_id}</code>
                    </td>
                    <td>{batch.product_name}</td>
                    <td>{batch.origin}</td>
                    <td>{formatQuantity(batch.quantity, batch.unit)}</td>
                    <td>
                      <StatusPill status={batch.current_status} />
                    </td>
                    <td>{batch.received_at ? formatTimestamp(batch.received_at) : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--small btn--secondary"
                        aria-label={`View history for batch ${batch.batch_id}`}
                        onClick={() => setHistoryRequest((previous) => ({ batchId: batch.batch_id, nonce: (previous?.nonce ?? 0) + 1 }))}
                      >
                        History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
