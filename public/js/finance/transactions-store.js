/**
 * Transactions data for the finance pages, backed by the server API
 * (/v1/transactions, stored in Supabase per signed-in user).
 *
 * Loads the user's categories, transactions and rules once, keeps them in
 * memory for fast filtering/charts, and applies changes through the API.
 * Same shape as the design's old local adapter (list, categories, create,
 * update, remove, restore, suggestCategory, learnRule, subscribe), except
 * that changes are async and fail with ApiError.
 */
import { api } from '../core/api.js';

const STOP_WORDS = new Set(['to', 'for', 'at', 'with', 'the', 'from', 'in', 'on', 'and', 'of']);

/** Same merchant key as the server (src/modules/transactions/categorizer.js); used for the rule text. */
export function merchantKey(description) {
  const head = String(description || '')
    .split(/\s[—–-]\s|#/)[0]
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&' ]+/gu, ' ');
  const words = [];
  for (const w of head.split(/\s+/).filter(Boolean)) {
    if (STOP_WORDS.has(w) || /^\d/.test(w)) break;
    words.push(w);
    if (words.length === 2) break;
  }
  return words.join(' ');
}

/** API transaction → page model (createdAt as a number for sorting). */
const fromApi = (t) => ({ ...t, createdAt: Date.parse(t.createdAt) || 0 });

/** Page model → API body. */
const toApi = (t) => ({
  type: t.type,
  amount: t.amount,
  description: t.description,
  date: t.date,
  categoryId: t.categoryId,
  categorySource: t.categorySource,
  aiSuggested: t.aiSuggested ?? null,
  aiConfidence: t.aiConfidence ?? null,
  note: t.note ?? '',
});

export async function loadTransactionsStore() {
  let categories = [];
  let txs = [];
  let rules = [];
  const listeners = new Set();
  const emit = (type, payload) => listeners.forEach((fn) => fn({ type, payload }));

  async function reload() {
    const data = await api.get('/transactions');
    categories = data.categories;
    txs = data.transactions.map(fromApi);
    rules = data.rules;
    emit('reloaded', null);
  }
  await reload();

  const byId = (id) => categories.find((c) => c.id === id) || categories.find((c) => c.id === 'other');

  return {
    categories: (type) => categories.filter((c) => !type || c.type === 'both' || c.type === type),
    category: byId,
    list: () => txs.slice(),
    rules: () => rules.slice(),
    merchantKey,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reload,

    async create(input) {
      const tx = fromApi(await api.post('/transactions', toApi(input)));
      txs.unshift(tx);
      emit('tx.created', tx);
      return tx;
    },

    async update(id, input) {
      const tx = fromApi(await api.patch(`/transactions/${encodeURIComponent(id)}`, toApi(input)));
      txs = txs.map((t) => (t.id === id ? tx : t));
      emit('tx.updated', tx);
      return tx;
    },

    async remove(id) {
      const tx = fromApi(await api.del(`/transactions/${encodeURIComponent(id)}`));
      txs = txs.filter((t) => t.id !== id);
      emit('tx.deleted', tx);
      return tx;
    },

    /** Undo a delete: re-create it with the same details. */
    async restore(tx) {
      const restored = fromApi(await api.post('/transactions', toApi(tx)));
      txs.unshift(restored);
      emit('tx.restored', restored);
      return restored;
    },

    /** Top 3 category suggestions: { categoryId, confidence, source }. */
    async suggestCategory({ description, type }) {
      const { suggestions } = await api.post('/transactions/suggest', { description, type });
      return suggestions;
    },

    async learnRule(pattern, categoryId) {
      if (!pattern) return;
      const rule = await api.put('/category-rules', { pattern, categoryId });
      rules = rules.filter((r) => r.pattern !== rule.pattern).concat(rule);
      emit('rule.learned', rule);
    },
  };
}
