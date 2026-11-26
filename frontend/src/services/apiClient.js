/**
 * Low-level HTTP helper for the Flask REST API.
 *
 * All paths are relative (e.g. "/api/health") so the Vite dev proxy forwards them
 * to the backend. Set VITE_API_BASE_URL only when the API is served from another origin.
 * Requests send same-origin credentials so the demo session cookie is included.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function performRequest(path, init) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'same-origin', ...init });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Network error while contacting the API.');
  }

  const body = await parseJson(response);
  if (!response.ok) {
    throw new ApiError(`Request to ${path} failed with status ${response.status}.`, {
      status: response.status,
      body,
    });
  }
  return body;
}

/**
 * Send a JSON request. Resolves with the parsed body for 2xx responses.
 * Rejects with ApiError for network failures and non-2xx responses (body attached when present).
 */
export async function sendJson(method, path, { body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  const init = { method, headers, signal };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return performRequest(path, init);
}

/** GET a JSON resource. See sendJson for resolution and error behaviour. */
export function getJson(path, { signal } = {}) {
  return sendJson('GET', path, { signal });
}
