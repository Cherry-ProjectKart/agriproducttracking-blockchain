import ActiveRoleBadge from './components/ActiveRoleBadge.jsx';
import AppHeader from './components/AppHeader.jsx';
import useDemoSession from './hooks/useDemoSession.js';
import DashboardPage from './pages/DashboardPage.jsx';
import RoleWorkspacePage from './pages/RoleWorkspacePage.jsx';

export default function App() {
  const { status, session, roles, rolesError, error, busy, selectRole, exitSession } =
    useDemoSession();

  const activeRole = session.active ? session : null;
  const activeRoleDetails = activeRole ? roles.find((role) => role.key === activeRole.role) : null;

  let content;
  if (status === 'loading') {
    content = (
      <p role="status" className="app-loading">
        Loading session…
      </p>
    );
  } else if (activeRole) {
    content = (
      <RoleWorkspacePage
        roleLabel={activeRole.role_label}
        roleDescription={activeRoleDetails?.description ?? null}
      />
    );
  } else {
    content = (
      <DashboardPage
        roles={roles}
        rolesError={rolesError}
        error={error}
        busy={busy}
        onSelectRole={selectRole}
      />
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AppHeader title="Blockchain Product Tracking">
        {activeRole ? (
          <>
            <ActiveRoleBadge label={activeRole.role_label} />
            <button
              type="button"
              className="btn btn--secondary"
              onClick={exitSession}
              disabled={busy}
            >
              Exit session
            </button>
          </>
        ) : null}
      </AppHeader>
      <main id="main-content" className="app-main">
        {activeRole && error ? (
          <div className="alert alert--danger" role="alert">
            {error}
          </div>
        ) : null}
        {content}
      </main>
      <footer className="app-footer">
        <p>Demonstration build · BPT-002</p>
      </footer>
    </div>
  );
}
