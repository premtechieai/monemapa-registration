/**
 * Helpers for Supabase (PostgREST) query results.
 */

/**
 * Return `data` from a Supabase result, or throw if the query failed.
 * The thrown error is unexpected (a 500), so the error handler logs it in full.
 * @param {{ data: any, error: any }} result
 * @param {string} table Table name, for the error message.
 */
export function unwrap({ data, error }, table) {
  if (error) throw Object.assign(new Error(`${table} query failed: ${error.message}`), { cause: error });
  return data;
}
