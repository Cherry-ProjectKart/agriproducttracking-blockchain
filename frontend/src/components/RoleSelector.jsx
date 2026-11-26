export default function RoleSelector({ roles, onSelect, disabled = false }) {
  return (
    <section className="role-selector" aria-labelledby="role-selector-heading">
      <h2 id="role-selector-heading" className="dashboard__section-heading">
        Choose a demonstration role
      </h2>
      <p className="role-selector__hint">
        Demonstration only: no password is required. The selected role controls what this session can do.
      </p>
      <ul className="role-grid">
        {roles.map((role) => (
          <li key={role.key}>
            <button
              type="button"
              className="role-card"
              onClick={() => onSelect(role.key)}
              disabled={disabled}
            >
              <span className="role-card__label">{role.label}</span>
              <span className="role-card__description">{role.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
