/**
 * Database client.
 *
 * Supabase is used purely as a hosted Postgres database, accessed from the
 * server with the SERVICE ROLE key (bypasses Row Level Security — never
 * expose it to the browser). Authentication, one-time codes, sessions and
 * email are all handled by this application, not by Supabase Auth.
 *
 * In sandbox mode `db` comes from an in-memory stand-in with the same query
 * API (src/sandbox/memoryDb.js), so every repository runs unchanged.
 */
import { createClient } from '@supabase/supabase-js';
import config from '../config/index.js';
import { getSecrets } from '../config/secrets.js';

function createDatabaseClient() {
  const secrets = getSecrets();
  return createClient(secrets.SUPABASE_URL, secrets.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Database access (service role). */
export const db = config.isSandbox ? (await import('../sandbox/memoryDb.js')).memoryDb : createDatabaseClient();
