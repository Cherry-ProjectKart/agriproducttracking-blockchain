import { useCallback, useEffect, useState } from 'react';
import { createSubmissionKey } from '../../services/batchService.js';
import { ApiError } from '../../services/apiClient.js';
import { createShipment, fetchShipmentBatches } from '../../services/shipmentService.js';
import { formatQuantity, formatTimestamp } from '../batches/batchFormatters.js';
import WorkspaceSummary from '../WorkspaceSummary.jsx';
import {
  EMPTY_SHIPMENT_FORM,
  NOTE_MAX_LENGTH,
  SHIPMENT_STATUSES,
  buildShipmentPayload,
  validateShipmentForm,
} from '../../utils/shipmentValidation.js';

const LIST_ERROR = 'Could not load the batches. Make sure the backend is running.';
const NETWORK_ERROR = 'Could not reach the server. The shipment update was not saved; try again.';
const GENERIC_ERROR = 'The shipment update could not be saved. Please try again.';
const FIELD_ORDER = ['batchId', 'status', 'note'];

function messageFrom(error) {
  if (error instanceof ApiError && error.body?.error) {
    return error.body.error.message || GENERIC_ERROR;
  }
  if (error instanceof ApiError && error.status === undefined) return NETWORK_ERROR;
  return GENERIC_ERROR;
}

/**
 * Distributor shipment workspace: pick a registered batch, choose a shipment status, add an
 * optional note, and save. Rendered only for the distributor role.
 */
export default function DistributorShipmentPanel() {
  const [list, setList] = useState({ status: 'loading', batches: [] });
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(EMPTY_SHIPMENT_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(null);
  const [submissionKey, setSubmissionKey] = useState(createSubmissionKey);

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

  function changeForm(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
    setSubmissionKey(createSubmissionKey());
  }

  function focusFirstInvalid(found) {
    const first = FIELD_ORDER.find((name) => name in found);
    if (first) document.getElementById(`shipment-${first}`)?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const found = validateShipmentForm({ batchId: selectedId, ...form });
    setErrors(found);
    setFormError(null);
    setSaved(null);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(found);
      return;
    }

    setSubmitting(true);
    try {
      const result = await createShipment(buildShipmentPayload({ batchId: selectedId, ...form }), submissionKey);
      setSaved(result);
      setForm(EMPTY_SHIPMENT_FORM);
      setSubmissionKey(createSubmissionKey());
      await loadBatches();
    } catch (error) {
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
    } finally {
      setSubmitting(false);
    }
  }

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
                  </tr>
                </thead>
                <tbody>
                  {list.batches.map((batch) => (
                    <tr key={batch.batch_id} className={batch.batch_id === selectedId ? 'batch-table__row--selected' : undefined}>
                      <td>
                        <input
                          type="radio"
                          name="shipment-batch"
                          value={batch.batch_id}
                          checked={batch.batch_id === selectedId}
                          onChange={() => {
                            setSelectedId(batch.batch_id);
                            setErrors((current) => {
                              const next = { ...current };
                              delete next.batchId;
                              return next;
                            });
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
            {errors.batchId ? (
              <p id="shipment-batchId-error" className="field-error">
                {errors.batchId}
              </p>
            ) : null}
          </fieldset>
        ) : null}
      </section>

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
            <p className="shipment-selected">Select a batch above to record its shipment.</p>
          )}

          <form className="batch-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
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
                  disabled={submitting}
                  aria-invalid={errors.status ? 'true' : 'false'}
                  aria-describedby={errors.status ? 'shipment-status-error' : undefined}
                  onChange={(event) => changeForm('status', event.target.value)}
                >
                  <option value="">Choose a status</option>
                  {SHIPMENT_STATUSES.map((status) => (
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
                  onChange={(event) => changeForm('note', event.target.value)}
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
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save shipment update'}
              </button>
              {submitting ? (
                <span role="status" className="form-status">
                  Saving shipment update…
                </span>
              ) : null}
            </div>
          </form>
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
