import { useEffect, useRef, useState } from 'react';
import { updateBatchDescription } from '../../services/batchService.js';
import { failureMessage, fieldErrorsFrom } from '../../utils/formErrors.js';
import { BATCH_LIMITS } from '../../utils/batchValidation.js';

const LOCKED_NOTICE =
  'Product name, quantity, unit, origin and harvest date are recorded on the ledger when the batch is registered, so they cannot be changed here.';

/**
 * Lets the farmer change a batch's description, the only detail that can change after registration.
 * The batch ID, QR code, tracking link, ledger and history are not affected by a change.
 */
export default function BatchDescriptionForm({ batch, onSaved, updateDescription = updateBatchDescription }) {
  const [value, setValue] = useState(batch.description ?? '');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  // Switching to a different batch clears the form and any message about the previous one.
  useEffect(() => {
    setValue(batch.description ?? '');
    setError(null);
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id]);

  // The saved description arrives from the parent after a save. Keep the message; show the saved text.
  useEffect(() => {
    setValue(batch.description ?? '');
  }, [batch.description]);

  async function save(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (value.length > BATCH_LIMITS.description) {
      setError(`Description must be ${BATCH_LIMITS.description} characters or fewer.`);
      return;
    }

    setError(null);
    setMessage(null);
    submitting.current = true;
    setBusy(true);
    try {
      // The API addresses a batch by its internal row id; the public batch ID is shown to the farmer.
      const updated = await updateDescription(batch.id, value.trim());
      setMessage('Description saved. The batch ID, QR code, tracking page and history are unchanged.');
      onSaved?.(updated);
    } catch (requestError) {
      const fields = fieldErrorsFrom(requestError);
      setError(fields.description ?? failureMessage(requestError, 'The description could not be saved. Please try again.'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function cancel() {
    setValue(batch.description ?? '');
    setError(null);
    setMessage(null);
  }

  return (
    <form className="batch-description-form" onSubmit={save} noValidate aria-busy={busy}>
      <p className="form-hint">{LOCKED_NOTICE}</p>
      <div className="form-field form-field--wide">
        <label htmlFor="batch-description-edit">Description (optional)</label>
        <textarea
          id="batch-description-edit"
          rows={3}
          maxLength={BATCH_LIMITS.description}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'batch-description-edit-error' : undefined}
        />
        {error ? (
          <p id="batch-description-edit-error" className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {message ? (
        <div className="alert alert--success" role="status">
          {message}
        </div>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save description'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={cancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
