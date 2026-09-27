/**
 * TransactionsService — the signed-in user's income and expenses.
 *
 * Rules enforced here (not only in the UI):
 *   - users only ever see and change their own rows (user id from the session)
 *   - the category must exist and fit the type (income/expense/both)
 *   - AI suggestions and saved rules come from the server (categorizer.js)
 */
import { AppError, Errors } from '../../lib/errors.js';
import * as repo from './transactions.repository.js';
import { merchantKey, suggestCategories } from './categorizer.js';

const CATEGORY_CACHE_MS = 5 * 60 * 1000;
let categoryCache = { at: 0, list: [] };

/** Categories rarely change (migrations only), so they're cached briefly. */
async function categories() {
  if (Date.now() - categoryCache.at > CATEGORY_CACHE_MS || !categoryCache.list.length) {
    categoryCache = { at: Date.now(), list: await repo.listCategories() };
  }
  return categoryCache.list;
}

const toCategory = (c) => ({ id: c.id, name: c.name, type: c.type, color: c.color });

/** Database row → API shape (camelCase, numbers as numbers). */
export const toTransaction = (row) => ({
  id: row.id,
  type: row.type,
  amount: Number(row.amount),
  description: row.description,
  date: String(row.date).slice(0, 10),
  categoryId: row.category_id,
  categorySource: row.category_source,
  aiSuggested: row.ai_suggested,
  aiConfidence: row.ai_confidence == null ? null : Number(row.ai_confidence),
  note: row.note ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRule = (r) => ({ pattern: r.pattern, categoryId: r.category_id });

/** Validated API input → database row (user_id is added by the repository). */
async function toRow(input) {
  const list = await categories();
  const check = (id, field) => {
    const c = list.find((x) => x.id === id);
    if (!c) throw Errors.validation({ [field]: 'Choose a valid category.' });
    return c;
  };
  const category = check(input.categoryId, 'categoryId');
  if (category.type !== 'both' && category.type !== input.type) {
    throw Errors.validation({ categoryId: `“${category.name}” can't be used for ${input.type}.` });
  }
  const aiSuggested = input.aiSuggested && list.some((x) => x.id === input.aiSuggested) ? input.aiSuggested : null;
  return {
    type: input.type,
    amount: input.amount,
    description: input.description,
    date: input.date,
    category_id: input.categoryId,
    category_source: input.categorySource,
    ai_suggested: aiSuggested,
    ai_confidence: aiSuggested ? input.aiConfidence ?? null : null,
    note: input.note || null,
  };
}

export async function listCategories() {
  return (await categories()).map(toCategory);
}

/** Everything the transaction pages need on load. */
export async function bootstrap(userId, range) {
  const [cats, txs, rules] = await Promise.all([categories(), repo.listTransactions(userId, range), repo.listRules(userId)]);
  return { categories: cats.map(toCategory), transactions: txs.map(toTransaction), rules: rules.map(toRule) };
}

export async function create(userId, input) {
  return toTransaction(await repo.createTransaction(userId, await toRow(input)));
}

export async function update(userId, id, input) {
  const row = await repo.updateTransaction(userId, id, await toRow(input));
  if (!row) throw Errors.notFound('Transaction');
  return toTransaction(row);
}

export async function remove(userId, id) {
  const row = await repo.deleteTransaction(userId, id);
  if (!row) throw Errors.notFound('Transaction');
  return toTransaction(row); // returned so the UI can offer "Undo"
}

export async function suggest(userId, { description, type }) {
  if (String(description).trim().length < 3) return { suggestions: [] };
  const [cats, txs, rules] = await Promise.all([categories(), repo.listTransactions(userId), repo.listRules(userId)]);
  const history = txs.slice(0, 500).map(toTransaction);
  return { suggestions: suggestCategories({ description, type, categories: cats, rules: rules.map(toRule), history }) };
}

/** Save "always categorize <merchant> as <category>". */
export async function saveRule(userId, { description, pattern, categoryId }) {
  const key = (pattern || merchantKey(description)).trim().toLowerCase();
  if (!key) throw new AppError(422, 'INVALID', 'Could not work out the merchant for this rule.', { fields: { pattern: 'Missing merchant.' } });
  if (!(await categories()).some((c) => c.id === categoryId)) throw Errors.validation({ categoryId: 'Choose a valid category.' });
  return toRule(await repo.upsertRule(userId, key, categoryId));
}
