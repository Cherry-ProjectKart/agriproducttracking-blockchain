import { useRef, useState } from 'react';
import { updatePreferences } from '../../services/accountSettingsService.js';
import { failureMessage, fieldErrorsFrom } from '../../utils/formErrors.js';
import { GRID_DENSITY_OPTIONS } from '../../utils/accountSettingsValidation.js';

/** Preferences section: table density. The choice applies to this account only. */
export default function PreferencesSection({ account, onSaved }) {
  const [density, setDensity] = useState(account.grid_density);
  const [message, setMessage] = useState(null);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  function cancel() {
    setDensity(account.grid_density);
    setMessage(null);
    setFormError(null);
  }

  async function save(event) {
    event.preventDefault();
    if (submitting.current) return;

    setMessage(null);
    setFormError(null);
    submitting.current = true;
    setBusy(true);
    try {
      const updated = await updatePreferences(density);
      setDensity(updated.grid_density);
      setMessage('Table density saved.');
      onSaved(updated);
    } catch (error) {
      const serverErrors = fieldErrorsFrom(error);
      setFormError(
        Object.keys(serverErrors).length > 0
          ? serverErrors.grid_density
          : failureMessage(error, 'Could not save your preference. Please try again.'),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="workspace-card account-section" aria-labelledby="preferences-heading">
      <h2 id="preferences-heading" className="dashboard__section-heading">
        Preferences
      </h2>
      <form className="auth-form" onSubmit={save} noValidate aria-busy={busy}>
        <fieldset className="role-fieldset" disabled={busy}>
          <legend>Table density</legend>
          <ul className="role-grid">
            {GRID_DENSITY_OPTIONS.map((option) => {
              const selected = density === option.key;
              return (
                <li key={option.key}>
                  <label className={`role-card role-option${selected ? ' role-option--selected' : ''}`}>
                    <input
                      type="radio"
                      name="grid_density"
                      value={option.key}
                      checked={selected}
                      onChange={(event) => setDensity(event.target.value)}
                      className="role-option__input"
                    />
                    <span className="role-card__label">{option.label}</span>
                    <span className="role-card__description">{option.description}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        {message ? (
          <div className="alert alert--success" role="status">
            {message}
          </div>
        ) : null}
        {formError ? (
          <div className="alert alert--danger" role="alert">
            {formError}
          </div>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={cancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
