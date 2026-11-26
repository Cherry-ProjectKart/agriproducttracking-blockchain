import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../services/apiClient.js';
import {
  endSession,
  fetchRoles,
  fetchSession,
  isSupportedRole,
  startSession,
} from '../services/accessService.js';

export const INACTIVE_SESSION = Object.freeze({
  active: false,
  role: null,
  role_label: null,
  display_name: null,
});

export const MESSAGES = Object.freeze({
  missingRole: 'Select a role to continue.',
  invalidRole: 'That role is not available. Choose Farmer, Distributor or Retailer.',
  sessionLoad: 'Could not check your session. Make sure the backend is running.',
  rolesLoad: 'Could not load the available roles. Make sure the backend is running.',
  startFailed: 'Could not start the session. Please try again.',
  exitFailed: 'Could not end the session. Please try again.',
});

function messageFrom(error, fallback) {
  const apiMessage = error instanceof ApiError ? error.body?.error?.message : undefined;
  return typeof apiMessage === 'string' && apiMessage ? apiMessage : fallback;
}

/**
 * Owns demo role-session state for the whole app.
 * The backend session cookie is the source of truth; this hook mirrors it for rendering.
 */
export default function useDemoSession() {
  const [status, setStatus] = useState('loading');
  const [session, setSession] = useState(INACTIVE_SESSION);
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

  const selectRole = useCallback(async (role) => {
    if (role === undefined || role === null || role === '') {
      setError(MESSAGES.missingRole);
      return false;
    }
    if (!isSupportedRole(role)) {
      setError(MESSAGES.invalidRole);
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      setSession(await startSession(role));
      return true;
    } catch (requestError) {
      setError(messageFrom(requestError, MESSAGES.startFailed));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const exitSession = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSession(await endSession());
      return true;
    } catch (requestError) {
      setError(messageFrom(requestError, MESSAGES.exitFailed));
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
    selectRole,
    exitSession,
  };
}
