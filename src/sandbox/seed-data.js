/**
 * Sandbox seed data: the categories from migration 003 and ~6 months of sample
 * transactions for the seeded demo user, so the dashboard and transactions
 * pages have something to show locally. SANDBOX ONLY.
 */
import crypto from 'node:crypto';

/** Must match the seed in supabase/migrations/003_transactions.sql. */
export const CATEGORIES = [
  ['salary', 'Salary', 'income', '#40a02b', 10],
  ['freelance', 'Freelance', 'income', '#179299', 20],
  ['investments', 'Investments', 'income', '#209fb5', 30],
  ['refunds', 'Refunds & other', 'income', '#7287fd', 40],
  ['groceries', 'Groceries', 'expense', '#40a02b', 110],
  ['dining', 'Dining out', 'expense', '#fe640b', 120],
  ['coffee', 'Coffee', 'expense', '#dc8a78', 130],
  ['transport', 'Transport', 'expense', '#1e66f5', 140],
  ['travel', 'Travel', 'expense', '#04a5e5', 150],
  ['shopping', 'Shopping', 'expense', '#ea76cb', 160],
  ['household', 'Household', 'expense', '#df8e1d', 170],
  ['utilities', 'Utilities & bills', 'expense', '#7287fd', 180],
  ['rent', 'Rent', 'expense', '#8839ef', 190],
  ['health', 'Health & fitness', 'expense', '#d20f39', 200],
  ['entertainment', 'Entertainment', 'expense', '#e64553', 210],
  ['other', 'Other', 'both', '#8c8fa1', 900],
].map(([id, name, type, color, sort_order]) => ({ id, name, type, color, sort_order }));

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Deterministic sample transactions (this month + 6 previous months). */
export function sampleTransactions(userId) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const now = new Date();
  const rows = [];
  const add = (date, type, amount, description, categoryId, source = 'ai') => {
    if (date > now) return;
    const at = date.toISOString();
    rows.push({
      id: crypto.randomUUID(),
      user_id: userId,
      type,
      amount: Math.round(amount * 100) / 100,
      description,
      date: iso(date),
      category_id: categoryId,
      category_source: source,
      ai_suggested: source === 'ai' ? categoryId : null,
      ai_confidence: source === 'ai' ? 0.9 : null,
      note: null,
      created_at: at,
      updated_at: at,
    });
  };

  for (let k = 0; k <= 6; k++) {
    const y = now.getFullYear();
    const m = now.getMonth() - k;
    const day = (d) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()), 12);
    add(day(1), 'income', 4200, 'Salary — Acme Ltd', 'salary');
    add(day(1), 'expense', 1650, 'Rent', 'rent');
    if (rnd() > 0.3) add(day(12), 'income', 300 + rnd() * 900, 'Invoice — freelance client', 'freelance');
    if (k % 3 === 0) add(day(20), 'income', 85 + rnd() * 60, 'Dividend — index fund', 'investments');
    [4, 11, 18, 26].forEach((d) => add(day(d), 'expense', 55 + rnd() * 70, pick(['Whole Foods Market', 'Carrefour', 'Costco']), 'groceries'));
    [7, 15, 22].forEach((d) => add(day(d), 'expense', 22 + rnd() * 50, pick(['Dinner — Bistro 42', 'Sushi Ko', 'Lunch with team']), 'dining'));
    [3, 9, 17, 24].forEach((d) => add(day(d), 'expense', 12 + rnd() * 30, pick(['Uber', 'Careem', 'Metro card']), 'transport'));
    [2, 10, 19].forEach((d) => add(day(d), 'expense', 4 + rnd() * 9, pick(['Blue Bottle Coffee', 'Starbucks']), 'coffee'));
    add(day(14), 'expense', 88 + rnd() * 20, 'Internet bill', 'utilities');
    add(day(6), 'expense', 15.99, 'Netflix', 'entertainment');
    if (rnd() > 0.4) add(day(21), 'expense', 40 + rnd() * 160, pick(['Amazon', 'Noon', 'Zara']), 'shopping');
    if (rnd() > 0.6) add(day(13), 'expense', 20 + rnd() * 60, 'Pharmacy', 'health');
    if (k === 4) add(day(16), 'expense', 420, 'Flight — Chicago', 'travel');
    if (k === 0) add(day(4), 'expense', 214, 'IKEA', 'household', 'user');
  }
  return rows;
}
