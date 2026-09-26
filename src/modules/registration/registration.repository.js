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

/** The registration whose emailed link carries this token (hash). */
export async function findByVerificationTokenHash(tokenHash) {
  return unwrap(await db.from(TABLE).select('*').eq('verification_token_hash', tokenHash).maybeSingle(), TABLE);
}

export async function create({ email, fullName, pollSecretHash, verificationTokenHash, expiresAt }) {
  const now = new Date().toISOString();
  const result = await db
    .from(TABLE)
    .insert({
      email,
      full_name: fullName,
      poll_secret_hash: pollSecretHash,
      verification_token_hash: verificationTokenHash,
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
  return update(id, { status: 'EXPIRED', verification_token_hash: null });
}

/**
 * Mark a pending registration verified — only if it is still pending, so a
 * double-clicked link can't verify twice.
 * @returns {Promise<object|null>} the updated row, or null if it wasn't pending
 */
export async function markVerified(id, userId) {
  const result = await db
    .from(TABLE)
    .update({ status: 'VERIFIED', verified_at: new Date().toISOString(), user_id: userId, verification_token_hash: null })
    .eq('id', id)
    .eq('status', 'PENDING')
    .select('*')
    .maybeSingle();
  return unwrap(result, TABLE);
}

/**
 * Claim the one-time right to start a session after verification.
 * The `session_issued_at is null` filter makes this atomic: if two polls
 * race, only one gets the row back (and only that one starts a session).
 * @returns {Promise<object|null>} the updated row, or null if already claimed
 */
export async function claimSession(id) {
  const result = await db
    .from(TABLE)
    .update({ session_issued_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'VERIFIED')
    .is('session_issued_at', null)
    .select('*')
    .maybeSingle();
  return unwrap(result, TABLE);
}
