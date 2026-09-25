/**
 * Data access for `public.registrations` — sign-ups awaiting email verification.
 */
import { db } from '../../lib/supabase.js';
import { unwrap } from '../../lib/db.js';

const TABLE = 'registrations';

export async function findById(id) {
  return unwrap(await db.from(TABLE).select('*').eq('id', id).maybeSingle(), TABLE);
}

export async function findPendingByEmail(email) {
  return unwrap(await db.from(TABLE).select('*').eq('email', email).eq('status', 'PENDING').maybeSingle(), TABLE);
}

export async function create({ email, fullName, authUserId, pollSecretHash, expiresAt }) {
  const now = new Date().toISOString();
  const result = await db
    .from(TABLE)
    .insert({
      email,
      full_name: fullName,
      auth_user_id: authUserId,
      poll_secret_hash: pollSecretHash,
      terms_accepted_at: now,
      last_sent_at: now,
      expires_at: expiresAt.toISOString(),
    })
    .select('*')
    .single();
  return unwrap(result, TABLE);
}

export async function update(id, patch) {
  return unwrap(await db.from(TABLE).update(patch).eq('id', id).select('*').single(), TABLE);
}

export async function markExpired(id) {
  return update(id, { status: 'EXPIRED' });
}

/**
 * Mark verified AND claim the one-time right to issue a session.
 * The `session_issued_at is null` filter makes this atomic: if two polls
 * race, only one gets the row back (and only that one creates a session).
 * @returns {Promise<object|null>} the updated row, or null if already claimed
 */
export async function markVerifiedAndClaimSession(id) {
  const now = new Date().toISOString();
  const result = await db
    .from(TABLE)
    .update({ status: 'VERIFIED', verified_at: now, session_issued_at: now })
    .eq('id', id)
    .is('session_issued_at', null)
    .select('*')
    .maybeSingle();
  return unwrap(result, TABLE);
}
