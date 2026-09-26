/**
 * Data access for `public.otp_challenges` — one row per sign-in code request.
 */
import { db } from '../../lib/supabase.js';
import { unwrap } from '../../lib/db.js';

const TABLE = 'otp_challenges';

export async function create({ userId, email, codeHash, attemptsLeft, expiresAt }) {
  const result = await db
    .from(TABLE)
    .insert({
      user_id: userId,
      email,
      code_hash: codeHash,
      attempts_left: attemptsLeft,
      expires_at: expiresAt.toISOString(),
    })
    .select('*')
    .single();
  return unwrap(result, TABLE);
}

export async function findById(id) {
  return unwrap(await db.from(TABLE).select('*').eq('id', id).maybeSingle(), TABLE);
}

/** Most recent challenge for an email (used for the resend cooldown). */
export async function findLatestForEmail(email) {
  const result = await db
    .from(TABLE)
    .select('*')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return unwrap(result, TABLE);
}

/** Revoke every still-open challenge for an email, e.g. when a new code is sent. */
export async function revokeOpenForEmail(email) {
  const result = await db
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('email', email)
    .is('consumed_at', null)
    .is('revoked_at', null);
  unwrap(result, TABLE);
}

/** Revoke one challenge (e.g. its email could not be sent). */
export async function revoke(id) {
  unwrap(await db.from(TABLE).update({ revoked_at: new Date().toISOString() }).eq('id', id), TABLE);
}

/**
 * Atomically spend one attempt (see spend_otp_attempt in migration 001).
 * @returns {Promise<number>} attempts left afterwards, or -1 if none could be spent.
 */
export async function spendAttempt(id) {
  return unwrap(await db.rpc('spend_otp_attempt', { p_challenge_id: id }), TABLE);
}

export async function markConsumed(id) {
  unwrap(await db.from(TABLE).update({ consumed_at: new Date().toISOString() }).eq('id', id), TABLE);
}
