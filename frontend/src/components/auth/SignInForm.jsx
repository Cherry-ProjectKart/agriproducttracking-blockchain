import { useRef, useState } from 'react';
import { ApiError } from '../../services/apiClient.js';
import { failureMessage, fieldErrorsFrom } from '../../utils/formErrors.js';
import { PATHS } from '../../utils/routes.js';
import { validateSignIn } from '../../utils/accountValidation.js';
import PasswordInput from './PasswordInput.jsx';

const FALLBACK = 'Could not sign in. Please try again.';

/**
 * Username and password sign-in. The server decides the role; this form sends only the credentials.
 * Wrong-credential errors use the server's generic message, which does not say whether the username exists.
 */
export default function SignInForm({ onSignIn, onNavigate }) {
  const [values, setValues] = useState({ username: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  function update(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting.current) return;

    const errors = validateSignIn(values);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    submitting.current = true;
    setBusy(true);
    try {
      await onSignIn({ username: values.username.trim(), password: values.password });
    } catch (error) {
      const serverErrors = fieldErrorsFrom(error);
      setFieldErrors(serverErrors);
      if (error instanceof ApiError && error.status === 401) {
        // Keep the username so the user can correct the password; never keep the password.
        setValues((current) => ({ ...current, password: '' }));
      }
      setFormError(Object.keys(serverErrors).length > 0 ? null : failureMessage(error, FALLBACK));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate aria-labelledby="sign-in-heading">
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="sign-in-username">Username</label>
          <input
            id="sign-in-username"
            name="username"
            type="text"
            value={values.username}
            onChange={update}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            aria-invalid={fieldErrors.username ? 'true' : undefined}
            aria-describedby={fieldErrors.username ? 'sign-in-username-error' : undefined}
          />
          {fieldErrors.username ? (
            <p id="sign-in-username-error" className="field-error" role="alert">
              {fieldErrors.username}
            </p>
          ) : null}
        </div>

        <PasswordInput
          label="Password"
          name="password"
          value={values.password}
          onChange={update}
          autoComplete="current-password"
          disabled={busy}
          error={fieldErrors.password}
        />
      </div>

      {formError ? (
        <div className="alert alert--danger" role="alert">
          {formError}
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </div>

      <p className="auth-switch">
        New to the project?{' '}
        <a href={PATHS.register} onClick={(event) => { event.preventDefault(); onNavigate(PATHS.register); }}>
          Create an account
        </a>
      </p>
    </form>
  );
}
