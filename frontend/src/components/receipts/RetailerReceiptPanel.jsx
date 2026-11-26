import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../services/apiClient.js';
import { createSubmissionKey } from '../../services/batchService.js';
import { confirmReceipt, fetchAwaitingReceipts } from '../../services/receiptService.js';
import { formatQuantity, formatTimestamp } from '../batches/batchFormatters.js';

const LIST_ERROR = 'Could not load the batches awaiting receipt. Make sure the backend is running.';
const NETWORK_ERROR = 'Could not reach the server. The receipt was not confirmed; try again.';
const GENERIC_ERROR = 'The receipt could not be confirmed. Please try again.';
const NOT_SELECTED = 'Select a batch to confirm.';

function messageFrom(error) {
  if (error instanceof ApiError && error.body?.error?.message) return error.body.error.message;
  if (error instanceof ApiError && error.status === undefined) return NETWORK_ERROR;
  return GENERIC_ERROR;
}

/**
 * Retailer workspace panel: batches awaiting receipt, a selection, and a confirm action.
 * Rendered only for the retailer role. A confirmed batch leaves the list.
 */
export default function RetailerReceiptPanel() {
  const [list, setList] = useState({ status: 'loading', batches: [] });
  const [selectedId, setSelectedId] = useState('');
  const [selectionError, setSelectionError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [submissionKey, setSubmissionKey] = useState(createSubmissionKey);

  const loadBatches = useCallback(async (signal) => {
    setList((current) => ({ ...current, status: 'loading' }));
    try {
      const batches = await fetchAwaitingReceipts({ signal });
      setList({ status: 'ready', batches });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setList({ status: 'error', batches: [] });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadBatches(controller.signal);
    return () => controller.abort();
  }, [loadBatches]);

  const selected = list.batches.find((batch) => batch.batch_id === selectedId) ?? null;

  async function handleConfirm(event) {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    setConfirmed(null);
    if (!selectedId) {
      setSelectionError(NOT_SELECTED);
      document.getElementById('receipt-batch-table')?.focus();
      return;
    }
    setSelectionError(null);

    setSubmitting(true);
    try {
      const result = await confirmReceipt(selectedId, submissionKey);
      setConfirmed(result);
      setSelectedId('');
      setSubmissionKey(createSubmissionKey());
      await loadBatches();
    } catch (error) {
      setFormError(messageFrom(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="receipt-panel">
      <section className="workspace-card" aria-labelledby="receipt-batches-heading">
        <h2 id="receipt-batches-heading" className="dashboard__section-heading">
          Batches awaiting receipt
        </h2>

        {list.status === 'loading' ? <p role="status">Loading batches…</p> : null}
        {list.status === 'error' ? (
          <div className="alert alert--danger" role="alert">
            {LIST_ERROR}
          </div>
        ) : null}
        {list.status === 'ready' && list.batches.length === 0 ? (
          <p className="batch-list__empty">No batches are awaiting receipt right now.</p>
        ) : null}
        {list.status === 'ready' && list.batches.length > 0 ? (
          <fieldset className="shipment-select" aria-describedby={selectionError ? 'receipt-selection-error' : undefined}>
            <legend className="visually-hidden">Select a batch to confirm</legend>
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
                  </tr>
                </thead>
                <tbody>
                  {list.batches.map((batch) => (
                    <tr key={batch.batch_id} className={batch.batch_id === selectedId ? 'batch-table__row--selected' : undefined}>
                      <td>
                        <input
                          type="radio"
                          name="receipt-batch"
                          value={batch.batch_id}
                          checked={batch.batch_id === selectedId}
                          onChange={() => {
                            setSelectedId(batch.batch_id);
                            setSelectionError(null);
                          }}
                          aria-label={`Select batch ${batch.batch_id}`}
                        />
                      </td>
                      <td>
                        <code className="batch-id">{batch.batch_id}</code>
                      </td>
                      <td>{batch.product_name}</td>
                      <td>{batch.origin}</td>
                      <td>{formatQuantity(batch.quantity, batch.unit)}</td>
                      <td>{batch.current_status}</td>
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

      {list.status === 'ready' && list.batches.length > 0 ? (
        <section className="workspace-card" aria-labelledby="receipt-confirm-heading">
          <h2 id="receipt-confirm-heading" className="dashboard__section-heading">
            Confirm receipt
          </h2>
          {selected ? (
            <p className="shipment-selected">
              You are confirming <code className="batch-id">{selected.batch_id}</code> {selected.product_name}. Its
              status will change from <strong>{selected.current_status}</strong> to{' '}
              <strong>Received by Retailer</strong>.
            </p>
          ) : (
            <p className="shipment-selected">Select a batch above to confirm its receipt.</p>
          )}

          <form className="batch-form" onSubmit={handleConfirm} noValidate aria-busy={submitting}>
            {formError ? (
              <div className="alert alert--danger" role="alert">
                {formError}
              </div>
            ) : null}
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? 'Confirming…' : 'Confirm receipt'}
              </button>
              {submitting ? (
                <span role="status" className="form-status">
                  Recording the receipt…
                </span>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      {confirmed ? (
        <section className="workspace-card" aria-labelledby="receipt-saved-heading">
          <div className="alert alert--success" role="status">
            <strong id="receipt-saved-heading">Receipt confirmed.</strong>{' '}
            <code className="batch-id">{confirmed.batch.batch_id}</code> is now{' '}
            <strong>{confirmed.batch.current_status}</strong>. Recorded in the ledger as block {confirmed.ledger_block.index}.
          </div>
          <dl className="batch-details__list">
            <div>
              <dt>Event</dt>
              <dd>{confirmed.event.event_type}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
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
    </div>
  );
}
