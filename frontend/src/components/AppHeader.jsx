export default function AppHeader({ title, children }) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <span className="app-header__brand" aria-hidden="true">
          ⛓
        </span>
        <span className="app-header__title">{title}</span>
        {children ? <div className="app-header__actions">{children}</div> : null}
      </div>
    </header>
  );
}
