import { useCallback, useEffect, useState } from 'react';
import PasswordSection from '../components/account/PasswordSection.jsx';
import PreferencesSection from '../components/account/PreferencesSection.jsx';
import ProfileSection from '../components/account/ProfileSection.jsx';
import { fetchAccount } from '../services/accountSettingsService.js';

const LOAD_ERROR = 'Could not load your account. Make sure the backend is running.';

/**
 * Account settings for the signed-in user (BPT-104): profile, preferences and password. It shows only the
 * account behind the session. After a change, onChanged refreshes the session so the header and the
 * table density follow the new values.
 */
export default function AccountSettingsPage({ onChanged }) {
  const [state, setState] = useState({ status: 'loading', account: null });

  const load = useCallback(async (signal) => {
    setState((current) => ({ ...current, status: 'loading' }));
    try {
      const account = await fetchAccount({ signal });
      setState({ status: 'ready', account });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setState({ status: 'error', account: null });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function handleSaved(account) {
    setState({ status: 'ready', account });
    onChanged?.();
  }

  return (
    <section className="workspace account-settings" id="account-settings-top" aria-labelledby="account-heading">
      <h1 id="account-heading" className="dashboard__heading">
        Account settings
      </h1>
      <p className="dashboard__description">
        Update your own profile, preferences and password. These changes apply only to your account.
      </p>

      {state.status === 'loading' ? <p role="status">Loading your account…</p> : null}
      {state.status === 'error' ? (
        <div className="alert alert--danger" role="alert">
          {LOAD_ERROR}
          <div className="form-actions">
            <button type="button" className="btn btn--secondary" onClick={() => load()}>
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <div className="account-settings__sections">
          <ProfileSection account={state.account} onSaved={handleSaved} />
          <PreferencesSection account={state.account} onSaved={handleSaved} />
          <PasswordSection />
        </div>
      ) : null}
    </section>
  );
}
