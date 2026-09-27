/**
 * HTTP client for the backend API.
 *
 * - Sends/receives JSON; cookies ride along automatically (same origin).
 * - Non-2xx responses throw an ApiError carrying the server's error `code`
 *   (e.g. EMAIL_EXISTS), which views switch on to decide what to show.
 */
import { getConfig } from './config.js';

export class ApiError extends Error {
  constructor(status, body) {
    const err = body?.error ?? {};
    super(err.message || 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = err.code || (status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN');
    this.details = err; // e.g. fields, attemptsLeft, retryAfterSec
  }
}

async function request(method, path, body) {
  const url = getConfig().apiBasePath + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { message: "Can't reach the server. Check your connection and try again." } });
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  // Sent with an (empty) JSON body: the API requires JSON on every change (CSRF guard).
  del: (path) => request('DELETE', path, {}),
};
