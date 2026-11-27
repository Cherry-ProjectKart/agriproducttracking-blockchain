import { useRef, useState } from 'react';
import { updateProfile } from '../../services/accountSettingsService.js';
import { failureMessage, fieldErrorsFrom } from '../../utils/formErrors.js';
import { validateProfile } from '../../utils/accountSettingsValidation.js';
import { formatTimestamp } from '../batches/batchFormatters.js';

/** Profile section: full name and username can be changed; role and creation date are shown only. */
export default function ProfileSection({ account, onSaved }) {
  const [values, setValues] = useState({ fullName: account.full_name, username: account.username });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  function update(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  function cancel() {
    setValues({ fullName: account.full_name, username: account.username });
    setErrors({});
    setFormError(null);
    setMessage(null);
  }

  async function save(event) {
    event.preventDefault();
    if (submitting.current) return;

    const clientErrors = validateProfile(values);
    setErrors(clientErrors);
    setFormError(null);
    setMessage(null);
    if (Object.keys(clientErrors).length > 0) return;

    submitting.current = true;
    setBusy(true);
    try {
      const updated = await updateProfile({ fullName: values.fullName.trim(), username: values.username.trim() });
      setValues({ fullName: updated.full_name, username: updated.username });
      setMessage('Profile saved.');
      onSaved(updated);
    } catch (error) {
      const serverErrors = fieldErrorsFrom(error);
      setErrors(serverErrors);
      setFormError(
        Object.keys(serverErrors).length > 0 ? null : failureMessage(error, 'Could not save your profile. Please try again.'),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="workspace-card account-section" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="dashboard__section-heading">
        Profile
      </h2>
      <form className="auth-form" onSubmit={save} noValidate aria-busy={busy}>
        <div className="form-grid">
          <div className="form-field form-field--wide">
            <label htmlFor="profile-full-name">Full name</label>
            <input
              id="profile-full-name"
              name="fullName"
              type="text"
              value={values.fullName}
              onChange={update}
              autoComplete="name"
              disabled={busy}
              aria-invalid={errors.full_name ? 'true' : undefined}
              aria-describedby={errors.full_name ? 'profile-full-name-error' : undefined}
            />
            {errors.full_name ? (
              <p id="profile-full-name-error" className="field-error" role="alert">
                {errors.full_name}
              </p>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="profile-username">Username</label>
            <input
              id="profile-username"
              name="username"
              type="text"
              value={values.username}
              onChange={update}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              aria-invalid={errors.username ? 'true' : undefined}
              aria-describedby={errors.username ? 'profile-username-error' : 'profile-username-hint'}
            />
            <p id="profile-username-hint" className="form-hint">
              3 to 32 characters: letters, numbers, dots, underscores or hyphens.
            </p>
            {errors.username ? (
              <p id="profile-username-error" className="field-error" role="alert">
                {errors.username}
              </p>
            ) : null}
          </div>
        </div>

        <dl className="account-facts">
          <div className="account-facts__item">
            <dt>Role</dt>
            <dd>{account.role_label}</dd>
          </div>
          <div className="account-facts__item">
            <dt>Account created</dt>
            <dd>{account.created_at ? formatTimestamp(account.created_at) : 'Not recorded'}</dd>
          </div>
        </dl>
        <p className="form-hint">Your role is set when the account is created and cannot be changed here.</p>

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
            {busy ? 'Saving…' : 'Save profile'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={cancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
