/**
 * Data access for categories, transactions and category_rules.
 * Every transaction/rule query is scoped to the owning user id.
 */
import { db } from '../../lib/supabase.js';
import { unwrap } from '../../lib/db.js';

export async function listCategories() {
  return unwrap(await db.from('categories').select('*').order('sort_order', { ascending: true }), 'categories');
}

/** The user's transactions, newest first. Optional inclusive date range (YYYY-MM-DD). */
export async function listTransactions(userId, { from, to } = {}) {
  let query = db.from('transactions').select('*').eq('user_id', userId);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);
  const result = await query.order('date', { ascending: false }).order('created_at', { ascending: false }).limit(5000);
  return unwrap(result, 'transactions');
}

export async function findTransaction(userId, id) {
  return unwrap(await db.from('transactions').select('*').eq('id', id).eq('user_id', userId).maybeSingle(), 'transactions');
}

export async function createTransaction(userId, row) {
  return unwrap(await db.from('transactions').insert({ ...row, user_id: userId }).select('*').single(), 'transactions');
}

export async function updateTransaction(userId, id, row) {
  const result = await db.from('transactions').update(row).eq('id', id).eq('user_id', userId).select('*').maybeSingle();
  return unwrap(result, 'transactions');
}

/** Delete and return the deleted row (null if it wasn't the user's). */
export async function deleteTransaction(userId, id) {
  const existing = await findTransaction(userId, id);
  if (!existing) return null;
  unwrap(await db.from('transactions').delete().eq('id', id).eq('user_id', userId), 'transactions');
  return existing;
}

export async function listRules(userId) {
  return unwrap(await db.from('category_rules').select('*').eq('user_id', userId), 'category_rules');
}

/** Create or replace the user's rule for a merchant pattern. */
export async function upsertRule(userId, pattern, categoryId) {
  const result = await db
    .from('category_rules')
    .upsert({ user_id: userId, pattern, category_id: categoryId }, { onConflict: 'user_id,pattern' })
    .select('*')
    .single();
  return unwrap(result, 'category_rules');
}
