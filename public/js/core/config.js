/**
 * Loads the public app configuration served by the backend
 * (see src/modules/config/config.routes.js). Everything configurable — API
 * base path, page routes, polling interval, OTP length — comes from here.
 */
let config = null;

export async function loadConfig() {
  const res = await fetch('/app-config.json', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load app config (HTTP ${res.status})`);
  config = Object.freeze(await res.json());
  return config;
}

/** The loaded config. Call loadConfig() once at startup first. */
export function getConfig() {
  if (!config) throw new Error('Config not loaded yet — call loadConfig() first.');
  return config;
}
