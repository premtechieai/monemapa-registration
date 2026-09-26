/**
 * Category suggestions for a transaction description.
 *
 * Priority (merged from the monemapa-main `categorize` edge function and the
 * design's local model):
 *   1. the user's saved rule for this merchant  → source "rule", confidence 0.99
 *   2. keyword model over the description       → source "model"
 *   3. the user's own past choices for this merchant boost the model
 *   4. still fewer than 3? the user's most-used categories → source "history"
 * Returns up to 3 suggestions: { categoryId, confidence, source }.
 * Pure functions — no database access here.
 */

const STOP_WORDS = new Set(['to', 'for', 'at', 'with', 'the', 'from', 'in', 'on', 'and', 'of']);

/** Keywords per category id (see migration 003 for the category list). */
const KEYWORDS = {
  salary: ['salary', 'payroll', 'paycheck', 'wage', 'wages', 'bonus', 'direct deposit'],
  freelance: ['invoice', 'freelance', 'client', 'upwork', 'fiverr', 'consulting', 'contract', 'gig'],
  investments: ['dividend', 'interest', 'stock', 'broker', 'etf'],
  refunds: ['refund', 'cashback', 'reimburse', 'reimbursement', 'rebate'],
  groceries: ['grocery', 'groceries', 'whole foods', 'trader joe', 'supermarket', 'aldi', 'costco', 'kroger', 'market', 'safeway', 'walmart', 'carrefour', 'lulu'],
  dining: ['restaurant', 'lunch', 'dinner', 'breakfast', 'brunch', 'pizza', 'burger', 'sushi', 'bistro', 'takeout', 'doordash', 'ubereats', 'uber eats', 'grubhub', 'talabat', 'deliveroo', 'mcdonald'],
  coffee: ['coffee', 'starbucks', 'blue bottle', 'espresso', 'latte', 'cafe'],
  transport: ['uber', 'lyft', 'careem', 'taxi', 'metro', 'train', 'bus', 'fuel', 'gas', 'petrol', 'parking', 'toll', 'salik', 'subway', 'transit'],
  travel: ['airbnb', 'hotel', 'flight', 'airline', 'booking', 'expedia', 'hostel', 'emirates'],
  shopping: ['amazon', 'noon', 'target', 'mall', 'zara', 'clothes', 'shoes', 'electronics', 'ebay', 'store', 'shop'],
  household: ['ikea', 'home depot', 'furniture', 'cleaning', 'hardware', 'lowes'],
  utilities: ['electric', 'electricity', 'dewa', 'water bill', 'internet', 'phone', 'utility', 'comcast', 'verizon', 'etisalat', 'du ', 'bill'],
  rent: ['rent', 'landlord', 'mortgage', 'lease'],
  health: ['pharmacy', 'doctor', 'gym', 'dental', 'dentist', 'cvs', 'walgreens', 'clinic', 'hospital', 'yoga', 'medical', 'prescription'],
  entertainment: ['netflix', 'spotify', 'cinema', 'movie', 'concert', 'steam', 'disney', 'hulu', 'tickets', 'osn', 'shahid'],
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_RES = Object.entries(KEYWORDS).map(([id, words]) => [
  id,
  words.map((w) => [w.trim(), new RegExp(`(^|[^a-z])${escapeRe(w.trim())}([^a-z]|$)`, 'i')]),
]);

/**
 * Stable merchant key from a description: the first one or two words before
 * " — ", "-" or "#", skipping stop words and numbers. "Uber to airport" → "uber".
 */
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

/**
 * @param {object} input
 * @param {string} input.description
 * @param {'income'|'expense'} [input.type]
 * @param {{id, type}[]} input.categories           all categories
 * @param {{pattern, categoryId}[]} input.rules     the user's saved rules
 * @param {{description, type, categoryId, categorySource}[]} input.history  the user's transactions
 */
export function suggestCategories({ description, type, categories, rules, history }) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const allowed = (id) => {
    const c = byId.get(id);
    return Boolean(c) && (c.type === 'both' || !type || c.type === type);
  };

  const text = ` ${String(description || '').toLowerCase()} `;
  const key = merchantKey(description);
  const scores = {};

  // Keyword model: longer keyword matches score higher.
  for (const [id, list] of KEYWORD_RES) {
    if (!allowed(id)) continue;
    for (const [word, re] of list) if (re.test(text)) scores[id] = (scores[id] || 0) + word.length + 4;
  }

  // The user's own past choices for this merchant.
  if (key) {
    for (const t of history) {
      if (t.categorySource === 'user' && merchantKey(t.description) === key && allowed(t.categoryId)) {
        scores[t.categoryId] = (scores[t.categoryId] || 0) + 6;
      }
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[1] ?? 0;
  const base = Math.min(0.97, 1 - Math.exp(-top / 9));
  let out = ranked.map(([id, score], i) => ({
    categoryId: id,
    confidence: +(i === 0 ? base : base * (score / top) * 0.75).toFixed(2),
    source: 'model',
  }));

  // A saved rule always wins.
  const rule = key && rules.find((r) => key === r.pattern || key.startsWith(`${r.pattern} `));
  if (rule && allowed(rule.categoryId)) {
    out = out.filter((o) => o.categoryId !== rule.categoryId);
    out.unshift({ categoryId: rule.categoryId, confidence: 0.99, source: 'rule' });
  }

  // Fill up to 3 with the user's most-used categories of this type.
  if (out.length < 3) {
    const freq = {};
    for (const t of history) if ((!type || t.type === type) && allowed(t.categoryId)) freq[t.categoryId] = (freq[t.categoryId] || 0) + 1;
    for (const [id] of Object.entries(freq).sort((a, b) => b[1] - a[1])) {
      if (out.length >= 3) break;
      if (!out.some((o) => o.categoryId === id)) out.push({ categoryId: id, confidence: 0.15, source: 'history' });
    }
  }
  if (!out.length && allowed('other')) out.push({ categoryId: 'other', confidence: 0.35, source: 'model' });

  return out.slice(0, 3);
}
