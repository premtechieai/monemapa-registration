/**
 * Data access for `public.sessions` — server-side sessions.
 */
import { db } from '../../lib/supabase.js';
import { unwrap } from '../../lib/db.js';

const TABLE = 'sessions';

export async function create({ userId, tokenHash, method, expiresAt }) {
  const result = await db
    .from(TABLE)
    .insert({ user_id: userId, token_hash: tokenHash, method, expires_at: expiresAt.toISOString() })
    .select('*')
    .single();
  return unwrap(result, TABLE);
}

export async function findByTokenHash(tokenHash) {
  return unwrap(await db.from(TABLE).select('*').eq('token_hash', tokenHash).maybeSingle(), TABLE);
}

export async function revoke(id) {
  unwrap(await db.from(TABLE).update({ revoked_at: new Date().toISOString() }).eq('id', id), TABLE);
}
