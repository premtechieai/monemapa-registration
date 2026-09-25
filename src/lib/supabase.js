/**
 * Supabase clients.
 *
 *  - `db` / `authAdmin` use the SERVICE ROLE key. They bypass Row Level
 *    Security and must never be exposed to the browser. Shared across
 *    requests because they hold no per-user session.
 *
 *  - `createAuthClient()` returns a fresh client using the ANON key for
 *    user-facing auth calls (send code, verify code, refresh session).
 *    A new instance per call is deliberate: verifyOtp/refreshSession store
 *    the resulting session on the client, and a shared instance would leak
 *    one user's session into another user's request.
 *
 * In sandbox mode the same three exports come from an in-memory stand-in
 * (src/sandbox/fakeSupabase.js), so every service and repository runs
 * unchanged without a Supabase project.
 */
import { createClient } from '@supabase/supabase-js';
import config from '../config/index.js';
import { getSecrets } from '../config/secrets.js';

function createSupabaseClients() {
  const secrets = getSecrets();

  // Server-side clients: no browser storage, no background token refresh.
  const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
  const serviceClient = createClient(secrets.SUPABASE_URL, secrets.SUPABASE_SERVICE_ROLE_KEY, { auth });

  return {
    db: serviceClient,
    authAdmin: serviceClient.auth.admin,
    createAuthClient: () => createClient(secrets.SUPABASE_URL, secrets.SUPABASE_ANON_KEY, { auth }).auth,
  };
}

const clients = config.isSandbox ? await import('../sandbox/fakeSupabase.js') : createSupabaseClients();

/** Database access (service role). */
export const db = clients.db;

/** Supabase Auth admin API (invite users, look up users, mint sessions). */
export const authAdmin = clients.authAdmin;

/** A fresh, single-use anon client for user-facing auth flows. */
export const createAuthClient = clients.createAuthClient;
