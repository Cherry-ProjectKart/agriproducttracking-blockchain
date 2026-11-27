import { useRef, useState } from 'react';
import { ApiError } from '../../services/apiClient.js';
import { failureMessage, fieldErrorsFrom } from '../../utils/formErrors.js';
import {
  PASSWORD_HINT,
  REGISTRATION_ROLES,
  validateRegistration,
} from '../../utils/accountValidation.js';
import { PATHS } from '../../utils/routes.js';
import PasswordInput from './PasswordInput.jsx';

const EMPTY = Object.freeze({
  full_name: '',
  username: '',
  password: '',
  confirm_password: '',
  role: '',
});

const FALLBACK = 'Could not create your account. Please check the highlighted fields and try again.';

/**
 * Account creation. Field names match the API, so server field errors map directly onto the inputs.
 * Values are kept after a failed attempt, except the passwords. A submit guard stops double-clicks
 * from sending the same registration twice.
 */
export default function RegisterForm({ onRegister, onNavigate }) {
  const [values, setValues] = useState(EMPTY);
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

    const errors = validateRegistration({
      fullName: values.full_name,
      username: values.username,
      password: values.password,
      confirmPassword: values.confirm_password,
      role: values.role,
    });
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    submitting.current = true;
    setBusy(true);
    try {
      await onRegister({
        fullName: values.full_name.trim(),
        username: values.username.trim(),
        password: values.password,
        confirmPassword: values.confirm_password,
        role: values.role,
      });
    } catch (error) {
      const serverErrors = fieldErrorsFrom(error);
      setFieldErrors(serverErrors);
      setValues((current) => ({ ...current, password: '', confirm_password: '' }));
      setFormError(Object.keys(serverErrors).length > 0 ? null : failureMessage(error, FALLBACK));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate aria-labelledby="register-heading">
      <div className="form-grid">
        <div className="form-field form-field--wide">
          <label htmlFor="register-full-name">Full name</label>
          <input
            id="register-full-name"
            name="full_name"
            type="text"
            value={values.full_name}
            onChange={update}
            autoComplete="name"
            disabled={busy}
            aria-invalid={fieldErrors.full_name ? 'true' : undefined}
            aria-describedby={fieldErrors.full_name ? 'register-full-name-error' : undefined}
          />
          {fieldErrors.full_name ? (
            <p id="register-full-name-error" className="field-error" role="alert">
              {fieldErrors.full_name}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor="register-username">Username</label>
          <input
            id="register-username"
            name="username"
            type="text"
            value={values.username}
            onChange={update}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            aria-invalid={fieldErrors.username ? 'true' : undefined}
            aria-describedby={fieldErrors.username ? 'register-username-error' : 'register-username-hint'}
          />
          <p id="register-username-hint" className="form-hint">
            3 to 32 characters: letters, numbers, dots, underscores or hyphens.
          </p>
          {fieldErrors.username ? (
            <p id="register-username-error" className="field-error" role="alert">
              {fieldErrors.username}
            </p>
          ) : null}
        </div>

        <PasswordInput
          label="Password"
          name="password"
          value={values.password}
          onChange={update}
          autoComplete="new-password"
          disabled={busy}
          error={fieldErrors.password}
          hint={PASSWORD_HINT}
        />

        <PasswordInput
          label="Confirm password"
          name="confirm_password"
          value={values.confirm_password}
          onChange={update}
          autoComplete="new-password"
          disabled={busy}
          error={fieldErrors.confirm_password}
        />
      </div>

      <fieldset className="role-fieldset" disabled={busy} aria-describedby={fieldErrors.role ? 'register-role-error' : undefined}>
        <legend>Your role</legend>
        <ul className="role-grid">
          {REGISTRATION_ROLES.map((role) => {
            const selected = values.role === role.key;
            return (
              <li key={role.key}>
                <label className={`role-card role-option${selected ? ' role-option--selected' : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value={role.key}
                    checked={selected}
                    onChange={update}
                    className="role-option__input"
                  />
                  <span className="role-card__label">{role.label}</span>
                  <span className="role-card__description">{role.description}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {fieldErrors.role ? (
          <p id="register-role-error" className="field-error" role="alert">
            {fieldErrors.role}
          </p>
        ) : null}
      </fieldset>

      {formError ? (
        <div className="alert alert--danger" role="alert">
          {formError}
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Creating account…' : 'Create Account'}
        </button>
      </div>

      <p className="auth-switch">
        Already registered?{' '}
        <a href={PATHS.signIn} onClick={(event) => { event.preventDefault(); onNavigate(PATHS.signIn); }}>
          Sign In
        </a>
      </p>
    </form>
  );
}
