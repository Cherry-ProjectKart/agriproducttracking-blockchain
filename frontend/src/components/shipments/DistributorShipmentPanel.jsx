import { useCallback, useEffect, useState } from 'react';
import { createSubmissionKey } from '../../services/batchService.js';
import { ApiError } from '../../services/apiClient.js';
import { createShipment, fetchShipmentBatches } from '../../services/shipmentService.js';
import { formatQuantity, formatTimestamp } from '../batches/batchFormatters.js';
import BatchHistoryPanel from '../history/BatchHistoryPanel.jsx';
import WorkspaceSummary from '../WorkspaceSummary.jsx';
import {
  EMPTY_SHIPMENT_FORM,
  NOTE_MAX_LENGTH,
  buildShipmentPayload,
  shipmentStatusModifier,
  validateShipmentForm,
} from '../../utils/shipmentValidation.js';

const LIST_ERROR = 'Could not load the batches. Make sure the backend is running.';
const NETWORK_ERROR = 'Could not reach the server. The shipment update was not saved; try again.';
const GENERIC_ERROR = 'The shipment update could not be saved. Please try again.';
const NO_NEXT_MOVEMENT = 'This batch has no further shipment update.';
const FIELD_ORDER = ['batchId', 'status', 'note'];

function messageFrom(error) {
  if (error instanceof ApiError && error.body?.error) {
    return error.body.error.message || GENERIC_ERROR;
  }
  if (error instanceof ApiError && error.status === undefined) return NETWORK_ERROR;
  return GENERIC_ERROR;
}

function StatusPill({ status }) {
  return (
    <span className={`shipment-status-pill shipment-status-pill--${shipmentStatusModifier(status)}`}>{status}</span>
  );
}

/**
 * Distributor shipment workspace. Pick a registered batch, see its details and movement history,
 * then record its next movement. A movement must follow the lifecycle, so only the next status is
 * offered. Saving asks for confirmation first, because a movement is permanent on the ledger.
 * Rendered only for the distributor role.
 */
export default function DistributorShipmentPanel() {
  const [list, setList] = useState({ status: 'loading', batches: [] });
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(EMPTY_SHIPMENT_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(null);
  const [submissionKey, setSubmissionKey] = useState(createSubmissionKey);
  const [historyRequest, setHistoryRequest] = useState(null);

  const loadBatches = useCallback(async (signal) => {
    setList((current) => ({ ...current, status: 'loading' }));
    try {
      const batches = await fetchShipmentBatches({ signal });
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
  const allowed = selected ? selected.next_statuses : [];

  // Keep the status on the only movement the selected batch can take, including after a refresh.
  useEffect(() => {
    if (!selected) return;
    setForm((current) =>
      selected.next_statuses.includes(current.status)
        ? current
        : { ...current, status: selected.next_statuses[0] ?? '' },
    );
  }, [selected]);

  function chooseBatch(batch) {
    setSelectedId(batch.batch_id);
    setForm((current) => ({ ...current, status: batch.next_statuses[0] ?? '' }));
    setErrors((current) => {
      const next = { ...current };
      delete next.batchId;
      return next;
    });
    setFormError(null);
    setConfirming(false);
    setSaved(null);
    setHistoryRequest((previous) => ({ batchId: batch.batch_id, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  function changeNote(value) {
    setForm((current) => ({ ...current, note: value }));
    setErrors((current) => {
      if (!('note' in current)) return current;
      const next = { ...current };
      delete next.note;
      return next;
    });
    setConfirming(false);
    setSubmissionKey(createSubmissionKey());
  }

  function focusFirstInvalid(found) {
    const first = FIELD_ORDER.find((name) => name in found);
    if (first) document.getElementById(`shipment-${first}`)?.focus();
  }

  function requestConfirmation(event) {
    event.preventDefault();
    if (submitting) return;

    const found = validateShipmentForm({ batchId: selectedId, allowedStatuses: allowed, ...form });
    if (selected && allowed.length === 0) found.status = NO_NEXT_MOVEMENT;
    setErrors(found);
    setFormError(null);
    setSaved(null);
    if (Object.keys(found).length > 0) {
      setConfirming(false);
      focusFirstInvalid(found);
      return;
    }
    setConfirming(true);
  }

  async function confirmAndRecord() {
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await createShipment(buildShipmentPayload({ batchId: selectedId, ...form }), submissionKey);
      setSaved(result);
      setForm(EMPTY_SHIPMENT_FORM);
      setConfirming(false);
      setSubmissionKey(createSubmissionKey());
      setHistoryRequest((previous) => ({ batchId: selectedId, nonce: (previous?.nonce ?? 0) + 1 }));
      await loadBatches();
    } catch (error) {
      setConfirming(false);
      setFormError(messageFrom(error));
      const details = error instanceof ApiError ? error.body?.error?.details : undefined;
      if (details && typeof details === 'object') {
        const fieldErrors = {};
        if (details.batch_id) fieldErrors.batchId = details.batch_id;
        if (details.status) fieldErrors.status = details.status;
        if (details.note) fieldErrors.note = details.note;
        setErrors(fieldErrors);
        focusFirstInvalid(fieldErrors);
      }
      // A conflict usually means the batch moved on elsewhere: reload so the status shown is current.
      if (error instanceof ApiError && error.status === 409) await loadBatches();
    } finally {
      setSubmitting(false);
    }
  }

  const eligibleCount = list.batches.filter((batch) => batch.next_statuses.length > 0).length;

  return (
    <div className="shipment-panel">
      <section className="workspace-card" aria-labelledby="shipment-batches-heading">
        <h2 id="shipment-batches-heading" className="dashboard__section-heading">
          Registered batches
        </h2>

        {list.status === 'loading' ? <p role="status">Loading batches…</p> : null}
        {list.status === 'error' ? (
          <div className="alert alert--danger" role="alert">
            {LIST_ERROR}
          </div>
        ) : null}
        {list.status === 'ready' && list.batches.length === 0 ? (
          <p className="batch-list__empty">No registered batches are available for shipment updates yet.</p>
        ) : null}
        {list.status === 'ready' && list.batches.length > 0 ? (
          <WorkspaceSummary
            label="Shipment summary"
            items={[
              { label: 'Batches available', value: list.batches.length },
              { label: 'Ready for next movement', value: eligibleCount },
              { label: 'Shipped', value: list.batches.filter((b) => b.current_status === 'Shipped').length },
              { label: 'In transit', value: list.batches.filter((b) => b.current_status === 'In Transit').length },
              {
                label: 'Delivered to retailer',
                value: list.batches.filter((b) => b.current_status === 'Delivered to Retailer').length,
              },
            ]}
          />
        ) : null}
        {list.status === 'ready' && list.batches.length > 0 ? (
          <fieldset className="shipment-select" aria-describedby={errors.batchId ? 'shipment-batchId-error' : undefined}>
            <legend className="visually-hidden">Select a batch</legend>
            <div className="table-wrapper">
              <table className="batch-table">
                <caption className="visually-hidden">Batches available for shipment updates</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="visually-hidden">Select</span></th>
                    <th scope="col">Batch ID</th>
                    <th scope="col">Product</th>
                    <th scope="col">Origin</th>
                    <th scope="col">Quantity</th>
                    <th scope="col">Current status</th>
                    <th scope="col">Next movement</th>
                  </tr>
                </thead>
                <tbody>
                  {list.batches.map((batch) => {
                    const canMove = batch.next_statuses.length > 0;
                    return (
                      <tr
                        key={batch.batch_id}
                        className={batch.batch_id === selectedId ? 'batch-table__row--selected' : undefined}
                      >
                        <td>
                          <input
                            type="radio"
                            name="shipment-batch"
                            value={batch.batch_id}
                            checked={batch.batch_id === selectedId}
                            disabled={!canMove}
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
                        <td>{canMove ? batch.next_statuses[0] : <span className="batch-list__empty">None</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {errors.batchId ? (
              <p id="shipment-batchId-error" className="field-error">
                {errors.batchId}
              </p>
            ) : null}
          </fieldset>
        ) : null}
      </section>

      {selected ? (
        <section className="workspace-card" aria-labelledby="shipment-details-heading">
          <h2 id="shipment-details-heading" className="dashboard__section-heading">
            Shipment details
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
              <dt>Registered on</dt>
              <dd>{formatTimestamp(selected.created_at)}</dd>
            </div>
            <div>
              <dt>Current status</dt>
              <dd>
                <StatusPill status={selected.current_status} />
              </dd>
            </div>
            <div>
              <dt>Next movement</dt>
              <dd>{allowed.length > 0 ? allowed[0] : 'None. No further shipment update can be recorded.'}</dd>
            </div>
          </dl>
          <p className="shipment-track-link">
            <a href={`/track/${selected.batch_id}`} target="_blank" rel="noopener noreferrer">
              Open the public tracking page for {selected.batch_id}
            </a>
          </p>
        </section>
      ) : null}

      {selected ? (
        <section className="workspace-card" aria-labelledby="shipment-history-heading">
          <h2 id="shipment-history-heading" className="dashboard__section-heading">
            Movement history
          </h2>
          <BatchHistoryPanel request={historyRequest} />
        </section>
      ) : null}

      {list.status === 'ready' && list.batches.length > 0 ? (
        <section className="workspace-card" aria-labelledby="shipment-form-heading">
          <h2 id="shipment-form-heading" className="dashboard__section-heading">
            Record a shipment update
          </h2>
          {selected ? (
            <p className="shipment-selected">
              Selected: <code className="batch-id">{selected.batch_id}</code> {selected.product_name}, currently{' '}
              <strong>{selected.current_status}</strong>
            </p>
          ) : (
            <p className="shipment-selected">Select a batch above to record its next movement.</p>
          )}

          <form className="batch-form" onSubmit={requestConfirmation} noValidate aria-busy={submitting}>
            <p className="batch-form__hint">
              Fields marked <span className="required-mark" aria-hidden="true">*</span> are required.
            </p>

            {formError ? (
              <div className="alert alert--danger" role="alert">
                {formError}
              </div>
            ) : null}

            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="shipment-status">
                  Shipment status <span className="required-mark" aria-hidden="true">*</span>
                </label>
                <select
                  id="shipment-status"
                  name="status"
                  value={form.status}
                  disabled={submitting || allowed.length === 0}
                  aria-invalid={errors.status ? 'true' : 'false'}
                  aria-describedby={errors.status ? 'shipment-status-error' : undefined}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, status: event.target.value }));
                    setConfirming(false);
                  }}
                >
                  <option value="">{allowed.length === 0 ? 'No movement available' : 'Choose a status'}</option>
                  {allowed.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                {errors.status ? (
                  <p id="shipment-status-error" className="field-error">
                    {errors.status}
                  </p>
                ) : null}
              </div>

              <div className="form-field form-field--wide">
                <label htmlFor="shipment-note">Note (optional)</label>
                <textarea
                  id="shipment-note"
                  name="note"
                  rows={2}
                  maxLength={NOTE_MAX_LENGTH}
                  value={form.note}
                  disabled={submitting}
                  aria-invalid={errors.note ? 'true' : 'false'}
                  aria-describedby={errors.note ? 'shipment-note-error' : 'shipment-note-hint'}
                  onChange={(event) => changeNote(event.target.value)}
                />
                <p id="shipment-note-hint" className="batch-form__hint">
                  One line, up to {NOTE_MAX_LENGTH} characters.
                </p>
                {errors.note ? (
                  <p id="shipment-note-error" className="field-error">
                    {errors.note}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting || !selected || allowed.length === 0}>
                Save shipment update
              </button>
            </div>
          </form>

          {confirming && selected ? (
            <div className="shipment-confirm" role="group" aria-labelledby="shipment-confirm-heading">
              <h3 id="shipment-confirm-heading">Confirm shipment update</h3>
              <p>
                Record <strong>{form.status}</strong> for <code className="batch-id">{selected.batch_id}</code>. The
                batch is currently <strong>{selected.current_status}</strong>. This is added to the ledger and cannot
                be undone.
              </p>
              <div className="form-actions">
                <button type="button" className="btn btn--primary" onClick={confirmAndRecord} disabled={submitting}>
                  {submitting ? 'Saving…' : 'Confirm and record'}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setConfirming(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </div>
              {submitting ? (
                <span role="status" className="form-status">
                  Saving shipment update…
                </span>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {saved ? (
        <section className="workspace-card" aria-labelledby="shipment-saved-heading">
          <div className="alert alert--success" role="status">
            <strong id="shipment-saved-heading">Shipment saved.</strong>{' '}
            <code className="batch-id">{saved.batch.batch_id}</code> is now{' '}
            <strong>{saved.batch.current_status}</strong>. Recorded in the ledger as block {saved.ledger_block.index}.
          </div>
          <dl className="batch-details__list">
            <div>
              <dt>Event</dt>
              <dd>{saved.event.event_type}</dd>
            </div>
            <div>
              <dt>Note</dt>
              <dd>{saved.event.note || 'No note'}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{formatTimestamp(saved.event.timestamp)}</dd>
            </div>
            <div>
              <dt>Block hash</dt>
              <dd>
                <code className="hash">{saved.ledger_block.block_hash}</code>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
