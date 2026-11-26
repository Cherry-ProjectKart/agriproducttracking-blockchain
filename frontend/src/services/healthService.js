import { ApiError, getJson } from './apiClient.js';

/**
 * Fetch the backend health report.
 *
 * The backend answers 503 with a full payload when the database is not ready,
 * so a 503 with a body is returned as-is rather than treated as a failure.
 * Anything else (network down, unexpected response) is returned as an
 * "unreachable" report so the UI can show a clear status.
 */
export async function fetchHealth({ signal } = {}) {
  try {
    return await getJson('/api/health', { signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (error instanceof ApiError && error.body && typeof error.body === 'object') {
      return error.body;
    }
    return { status: 'unreachable', application: null, database: null };
  }
}
