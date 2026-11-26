import { useState } from 'react';
import { ApiError } from '../../services/apiClient.js';
import { createBatch as createBatchRequest, createSubmissionKey } from '../../services/batchService.js';
import { BATCH_LIMITS, EMPTY_BATCH_FORM, buildBatchPayload, validateBatchForm } from '../../utils/batchValidation.js';

const FIELD_ORDER = ['productName', 'description', 'quantity', 'unit', 'origin', 'harvestDate'];

const NETWORK_ERROR = 'Could not reach the server. Your batch was not saved; try again.';
const GENERIC_ERROR = 'The batch could not be registered. Please try again.';

function fieldId(name) {
  return `batch-${name}`;
}

/**
 * Product batch registration form for the farmer workspace.
 *
 * The submission key is reused across retries of the same entry and replaced when the
 * entry changes or a batch is saved, so a repeated submit cannot create a duplicate.
 */
export default function BatchRegistrationForm({ onRegistered, createBatch = createBatchRequest }) {
  const [values, setValues] = useState(EMPTY_BATCH_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(createSubmissionKey);

  function handleChange(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
    setSubmissionKey(createSubmissionKey());
  }

  function focusFirstInvalid(errors) {
    const first = FIELD_ORDER.find((name) => name in errors);
    if (first) document.getElementById(fieldId(first))?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const errors = validateBatchForm(values);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid(errors);
      return;
    }

    setSubmitting(true);
    try {
      const batch = await createBatch(buildBatchPayload(values), submissionKey);
      setValues(EMPTY_BATCH_FORM);
      setSubmissionKey(createSubmissionKey());
      onRegistered?.(batch);
    } catch (error) {
      if (error instanceof ApiError && error.status === undefined) {
        setFormError(NETWORK_ERROR);
      } else if (error instanceof ApiError && error.body?.error) {
        const { message, details } = error.body.error;
        if (details && typeof details === 'object') {
          setFieldErrors(details);
          focusFirstInvalid(details);
        }
        setFormError(message || GENERIC_ERROR);
      } else {
        setFormError(GENERIC_ERROR);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fieldProps(name) {
    const hasError = name in fieldErrors;
    return {
      id: fieldId(name),
      name,
      value: values[name],
      onChange: (event) => handleChange(name, event.target.value),
      'aria-invalid': hasError ? 'true' : 'false',
      'aria-describedby': hasError ? `${fieldId(name)}-error` : undefined,
      disabled: submitting,
    };
  }

  function renderError(name) {
    if (!(name in fieldErrors)) return null;
    return (
      <p id={`${fieldId(name)}-error`} className="field-error">
        {fieldErrors[name]}
      </p>
    );
  }

  return (
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
          <label htmlFor={fieldId('productName')}>
            Product name <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input type="text" maxLength={BATCH_LIMITS.productName} autoComplete="off" {...fieldProps('productName')} />
          {renderError('productName')}
        </div>

        <div className="form-field">
          <label htmlFor={fieldId('origin')}>
            Origin or farm location <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input type="text" maxLength={BATCH_LIMITS.origin} autoComplete="off" {...fieldProps('origin')} />
          {renderError('origin')}
        </div>

        <div className="form-field">
          <label htmlFor={fieldId('quantity')}>
            Quantity <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input type="number" min="0" step="any" inputMode="decimal" {...fieldProps('quantity')} />
          {renderError('quantity')}
        </div>

        <div className="form-field">
          <label htmlFor={fieldId('unit')}>
            Unit <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input type="text" maxLength={BATCH_LIMITS.unit} placeholder="for example kg or crates" autoComplete="off" {...fieldProps('unit')} />
          {renderError('unit')}
        </div>

        <div className="form-field">
          <label htmlFor={fieldId('harvestDate')}>
            Harvest or registration date <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input type="date" {...fieldProps('harvestDate')} />
          {renderError('harvestDate')}
        </div>

        <div className="form-field form-field--wide">
          <label htmlFor={fieldId('description')}>Description</label>
          <textarea rows={3} maxLength={BATCH_LIMITS.description} {...fieldProps('description')} />
          {renderError('description')}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Registering…' : 'Register batch'}
        </button>
        {submitting ? (
          <span role="status" className="form-status">
            Saving batch…
          </span>
        ) : null}
      </div>
    </form>
  );
}
