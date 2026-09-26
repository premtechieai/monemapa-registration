/**
 * Data access for `public.profiles` — the registered-user record.
 * Repositories contain queries only; business rules live in services.
 */
import { db } from '../../lib/supabase.js';
import { unwrap } from '../../lib/db.js';

const TABLE = 'profiles';
const UNIQUE_VIOLATION = '23505';

export async function findByEmail(email) {
  return unwrap(await db.from(TABLE).select('*').eq('email', email).maybeSingle(), TABLE);
}

export async function findById(id) {
  return unwrap(await db.from(TABLE).select('*').eq('id', id).maybeSingle(), TABLE);
}

/**
 * Create the profile for a newly verified user. If a profile with this email
 * already exists (e.g. a double-clicked link), that one is returned instead.
 */
export async function create({ email, fullName }) {
  const { data, error } = await db.from(TABLE).insert({ email, full_name: fullName }).select('*').single();
  if (error?.code === UNIQUE_VIOLATION) return findByEmail(email);
  return unwrap({ data, error }, TABLE);
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
