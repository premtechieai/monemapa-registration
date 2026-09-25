/**
 * Data access for `public.profiles` — the registered-user record.
 * Repositories contain queries only; business rules live in services.
 */
import { db } from '../../lib/supabase.js';
import { unwrap } from '../../lib/db.js';

const TABLE = 'profiles';

export async function findByEmail(email) {
  return unwrap(await db.from(TABLE).select('*').eq('email', email).maybeSingle(), TABLE);
}

export async function findById(id) {
  return unwrap(await db.from(TABLE).select('*').eq('id', id).maybeSingle(), TABLE);
}

/**
 * Create the profile for a newly verified user. Idempotent: if two status
 * polls race, the second insert is ignored and the existing row returned.
 */
export async function createFromRegistration({ id, email, fullName }) {
  const result = await db
    .from(TABLE)
    .upsert({ id, email, full_name: fullName }, { onConflict: 'id', ignoreDuplicates: true });
  unwrap(result, TABLE);
  return findById(id);
}

export async function touchLastLogin(id) {
  const result = await db
    .from(TABLE)
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  return unwrap(result, TABLE);
}
