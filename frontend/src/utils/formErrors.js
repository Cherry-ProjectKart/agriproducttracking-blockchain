import { ApiError } from '../services/apiClient.js';

/** Per-field messages from an API error body ({ error: { details: { field: message } } }). */
export function fieldErrorsFrom(error) {
  const details = error instanceof ApiError ? error.body?.error?.details : undefined;
  if (!details || typeof details !== 'object') return {};
  return Object.fromEntries(
    Object.entries(details).filter(([, message]) => typeof message === 'string' && message),
  );
}

/** A general message from an API error, or the fallback when the server did not give one. */
export function messageFrom(error, fallback) {
  const message = error instanceof ApiError ? error.body?.error?.message : undefined;
  return typeof message === 'string' && message ? message : fallback;
}

/** Message for a failed submit: the server's own message when present, otherwise a network message for
 * transport failures (no HTTP status) and the fallback for other errors. */
export function failureMessage(error, fallback) {
  if (error instanceof ApiError && error.status) return messageFrom(error, fallback);
  return NETWORK_MESSAGE;
}

export const NETWORK_MESSAGE = 'Could not reach the server. Check that the backend is running, then try again.';
