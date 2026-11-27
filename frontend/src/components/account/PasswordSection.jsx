import { useRef, useState } from 'react';
import { changePassword } from '../../services/accountSettingsService.js';
import { PASSWORD_HINT } from '../../utils/accountValidation.js';
import { failureMessage, fieldErrorsFrom } from '../../utils/formErrors.js';
import { validatePasswordChange } from '../../utils/accountSettingsValidation.js';
import PasswordInput from '../auth/PasswordInput.jsx';

const EMPTY = Object.freeze({ current_password: '', new_password: '', confirm_password: '' });

/**
 * Password section: current password, new password and confirmation. Failed attempts clear every password
 * field, so no password stays on the screen after a failure.
 */
export default function PasswordSection() {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  function update(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  function clear() {
    setValues(EMPTY);
    setErrors({});
    setFormError(null);
    setMessage(null);
  }

  async function save(event) {
    event.preventDefault();
    if (submitting.current) return;

    const clientErrors = validatePasswordChange({
      currentPassword: values.current_password,
      newPassword: values.new_password,
      confirmPassword: values.confirm_password,
    });
    setErrors(clientErrors);
    setFormError(null);
    setMessage(null);
    if (Object.keys(clientErrors).length > 0) return;

    submitting.current = true;
    setBusy(true);
    try {
      const text = await changePassword({
        currentPassword: values.current_password,
        newPassword: values.new_password,
        confirmPassword: values.confirm_password,
      });
      setValues(EMPTY);
      setErrors({});
      setMessage(text);
    } catch (error) {
      const serverErrors = fieldErrorsFrom(error);
      setValues(EMPTY);
      setErrors(serverErrors);
      setFormError(
        Object.keys(serverErrors).length > 0 ? null : failureMessage(error, 'Could not change your password. Please try again.'),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="workspace-card account-section" aria-labelledby="password-heading">
      <h2 id="password-heading" className="dashboard__section-heading">
        Change password
      </h2>
      <form className="auth-form" onSubmit={save} noValidate aria-busy={busy}>
        <div className="form-grid">
          <PasswordInput
            label="Current password"
            name="current_password"
            value={values.current_password}
            onChange={update}
            autoComplete="current-password"
            disabled={busy}
            error={errors.current_password}
          />
          <PasswordInput
            label="New password"
            name="new_password"
            value={values.new_password}
            onChange={update}
            autoComplete="new-password"
            disabled={busy}
            error={errors.new_password}
            hint={PASSWORD_HINT}
          />
          <PasswordInput
            label="Confirm new password"
            name="confirm_password"
            value={values.confirm_password}
            onChange={update}
            autoComplete="new-password"
            disabled={busy}
            error={errors.confirm_password}
          />
        </div>

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
            {busy ? 'Changing…' : 'Change password'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={clear} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
