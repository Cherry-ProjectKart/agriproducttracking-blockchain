import { useCallback, useEffect, useState } from 'react';
import ActiveRoleBadge from './components/ActiveRoleBadge.jsx';
import AppHeader from './components/AppHeader.jsx';
import useAccountSession from './hooks/useAccountSession.js';
import AccountSettingsPage from './pages/AccountSettingsPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import RoleWorkspacePage from './pages/RoleWorkspacePage.jsx';
import SignInPage from './pages/SignInPage.jsx';
import { authPageFromPath, isAccountPath, isWorkspacePath, PATHS, workspacePathForRole } from './utils/routes.js';

export default function App() {
  const account = useAccountSession();
  const { status, session, roles, rolesError, error, busy, signIn, register, signOut, refreshSession } = account;
  const [path, setPath] = useState(() => window.location.pathname);

  const navigate = useCallback((to, { replace = false } = {}) => {
    if (replace) {
      window.history.replaceState({}, '', to);
    } else {
      window.history.pushState({}, '', to);
    }
    setPath(to);
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const activeRole = session.active ? session : null;
  const activeRoleDetails = activeRole ? roles.find((role) => role.key === activeRole.role) : null;

  const activeRoleKey = activeRole ? activeRole.role : null;
  const expectedPath = activeRoleKey ? workspacePathForRole(activeRoleKey) : null;

  // Table density is a per-account preference. It comes from the session, so it follows the signed-in user.
  const gridDensity = activeRole && activeRole.grid_density === 'compact' ? 'compact' : 'comfortable';
  useEffect(() => {
    document.documentElement.dataset.gridDensity = gridDensity;
  }, [gridDensity]);

  // Route guard. A signed-in user is moved to their own workspace address, whatever workspace address they
  // typed, unless they are on the account settings page. A signed-out visitor is moved off any protected
  // address to sign-in. The server is still the authority: these redirects only keep the address consistent
  // with the session.
  useEffect(() => {
    if (status !== 'ready') return;
    if (activeRoleKey) {
      if (path !== expectedPath && !isAccountPath(path)) navigate(expectedPath, { replace: true });
    } else if (isWorkspacePath(path) || isAccountPath(path)) {
      navigate(PATHS.signIn, { replace: true });
    }
  }, [status, activeRoleKey, expectedPath, path, navigate]);

  async function handleSignOut() {
    const signedOut = await signOut();
    if (signedOut) navigate(PATHS.signIn, { replace: true });
  }

  let content;
  if (status === 'loading') {
    content = (
      <p role="status" className="app-loading">
        Loading your session…
      </p>
    );
  } else if (activeRole && isAccountPath(path)) {
    content = <AccountSettingsPage onChanged={refreshSession} />;
  } else if (activeRole) {
    content = (
      <RoleWorkspacePage
        role={activeRole.role}
        roleLabel={activeRole.role_label}
        roleDescription={activeRoleDetails?.description ?? null}
      />
    );
  } else if (authPageFromPath(path) === 'register') {
    content = <RegisterPage onRegister={register} onNavigate={navigate} />;
  } else {
    content = <SignInPage onSignIn={signIn} onNavigate={navigate} />;
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AppHeader title="Blockchain Product Tracking">
        {activeRole ? (
          <>
            <ActiveRoleBadge label={activeRole.role_label} name={activeRole.display_name} />
            <a
              className="btn btn--secondary"
              href={PATHS.account}
              aria-current={isAccountPath(path) ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(PATHS.account);
              }}
            >
              Account settings
            </a>
            <button type="button" className="btn btn--secondary" onClick={handleSignOut} disabled={busy}>
              Sign out
            </button>
          </>
        ) : null}
      </AppHeader>
      <main id="main-content" className="app-main">
        {error ? (
          <div className="alert alert--danger" role="alert">
            {error}
          </div>
        ) : null}
        {!activeRole && rolesError && status !== 'loading' ? (
          <div className="alert alert--danger" role="alert">
            {rolesError}
          </div>
        ) : null}
        {content}
      </main>
      <footer className="app-footer">
        <p>Demonstration build · BPT-104</p>
      </footer>
    </div>
  );
}
