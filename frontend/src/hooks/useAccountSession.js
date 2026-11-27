import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../services/apiClient.js';
import { endSession, fetchRoles, fetchSession, signIn } from '../services/accessService.js';
import { registerAccount } from '../services/accountService.js';

export const SIGNED_OUT = Object.freeze({
  active: false,
  role: null,
  role_label: null,
  display_name: null,
  username: null,
});

export const MESSAGES = Object.freeze({
  sessionLoad: 'Could not check your sign-in. Make sure the backend is running.',
  rolesLoad: 'Could not load the account roles. Make sure the backend is running.',
  signOutFailed: 'Could not sign out. Please try again.',
});

/**
 * Owns sign-in state for the whole app. The backend session cookie is the source of truth; this hook
 * mirrors it for rendering. Forms call signIn and register and handle their own errors: both reject
 * with an ApiError or a network error, and the session only changes on success.
 */
export default function useAccountSession() {
  const [status, setStatus] = useState('loading');
  const [session, setSession] = useState(SIGNED_OUT);
  const [roles, setRoles] = useState([]);
  const [rolesError, setRolesError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    Promise.allSettled([fetchRoles({ signal }), fetchSession({ signal })]).then(
      ([rolesResult, sessionResult]) => {
        if (signal.aborted) return;
        if (rolesResult.status === 'fulfilled') {
          setRoles(rolesResult.value);
        } else {
          setRolesError(MESSAGES.rolesLoad);
        }
        if (sessionResult.status === 'fulfilled') {
          setSession(sessionResult.value);
        } else {
          setError(MESSAGES.sessionLoad);
        }
        setStatus('ready');
      },
    );

    return () => controller.abort();
  }, []);

  const signInWith = useCallback(async (credentials) => {
    const next = await signIn(credentials);
    setSession(next);
    return next;
  }, []);

  const registerWith = useCallback(async (values) => {
    const next = await registerAccount(values);
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSession(await endSession());
      return true;
    } catch (requestError) {
      const apiMessage = requestError instanceof ApiError ? requestError.body?.error?.message : undefined;
      setError(typeof apiMessage === 'string' && apiMessage ? apiMessage : MESSAGES.signOutFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    session,
    roles,
    rolesError,
    error,
    busy,
    signIn: signInWith,
    register: registerWith,
    signOut,
  };
}
