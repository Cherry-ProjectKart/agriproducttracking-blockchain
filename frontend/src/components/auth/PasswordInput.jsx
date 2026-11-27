import { useId, useState } from 'react';

/** Password field with a show/hide control. The value is never logged or echoed. */
export default function PasswordInput({
  label,
  name,
  value,
  onChange,
  autoComplete,
  disabled = false,
  error = null,
  hint = null,
  inputRef = null,
}) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="form-field form-field--password">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-input">
        <input
          id={inputId}
          ref={inputRef}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          className="password-input__toggle"
          onClick={() => setVisible((current) => !current)}
          aria-pressed={visible}
          aria-controls={inputId}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          disabled={disabled}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="form-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
