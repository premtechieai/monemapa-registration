/* MoneMapa · Transactions service v1.0
 * Framework-agnostic module. Exposes window.MoneMapaTx:
 *   categories(type?)                 -> Category[]
 *   list()                            -> Transaction[]
 *   create(input) / update(id, patch) -> Transaction
 *   remove(id) -> Transaction ; restore(tx)
 *   suggestCategory({description, type}) -> Promise<Suggestion[]>  (top 3, {categoryId, confidence, source})
 *   learnRule(pattern, categoryId) ; rules() ; merchantKey(description)
 *   subscribe(fn) -> unsubscribe   events: tx.created | tx.updated | tx.deleted | tx.restored | rule.learned
 * Storage and AI are local adapters (localStorage + keyword/history model).
 * Replace with: POST /v1/transactions · PATCH/DELETE /v1/transactions/{id} · POST /v1/ai/categorize · POST /v1/ai/rules
 */
(function () {
  if (window.MoneMapaTx) return;

  const CATS = [
    ['salary', 'Salary', 'income', '#40a02b'],
    ['freelance', 'Freelance', 'income', '#179299'],
    ['investments', 'Investments', 'income', '#209fb5'],
    ['refunds', 'Refunds & other', 'income', '#7287fd'],
    ['groceries', 'Groceries', 'expense', '#40a02b'],
    ['dining', 'Dining out', 'expense', '#fe640b'],
    ['coffee', 'Coffee', 'expense', '#dc8a78'],
    ['transport', 'Transport', 'expense', '#1e66f5'],
    ['travel', 'Travel', 'expense', '#04a5e5'],
    ['shopping', 'Shopping', 'expense', '#ea76cb'],
    ['household', 'Household', 'expense', '#df8e1d'],
    ['utilities', 'Utilities & bills', 'expense', '#7287fd'],
    ['rent', 'Rent', 'expense', '#8839ef'],
    ['health', 'Health & fitness', 'expense', '#d20f39'],
    ['entertainment', 'Entertainment', 'expense', '#e64553'],
    ['other', 'Other', 'both', '#8c8fa1']
  ].map(([id, name, type, color]) => ({ id, name, type, color }));
  const byId = Object.fromEntries(CATS.map(c => [c.id, c]));

  const KW = {
    salary: ['salary', 'payroll', 'paycheck', 'wages', 'bonus'],
    freelance: ['invoice', 'freelance', 'client', 'upwork', 'fiverr', 'consulting'],
    investments: ['dividend', 'interest', 'stock', 'broker', 'etf'],
    refunds: ['refund', 'cashback', 'reimburse', 'reimbursement', 'rebate'],
    groceries: ['grocery', 'groceries', 'whole foods', 'trader joe', 'supermarket', 'aldi', 'costco', 'kroger', 'market', 'safeway'],
    dining: ['restaurant', 'lunch', 'dinner', 'breakfast', 'brunch', 'pizza', 'burger', 'sushi', 'bistro', 'takeout', 'doordash', 'ubereats'],
    coffee: ['coffee', 'starbucks', 'blue bottle', 'espresso', 'latte', 'cafe'],
    transport: ['uber', 'lyft', 'taxi', 'metro', 'train', 'bus', 'fuel', 'gas', 'petrol', 'parking', 'toll', 'subway'],
    travel: ['airbnb', 'hotel', 'flight', 'airline', 'booking', 'expedia', 'hostel'],
    shopping: ['amazon', 'target', 'mall', 'zara', 'clothes', 'shoes', 'electronics', 'ikea'],
    household: ['ikea', 'home depot', 'furniture', 'cleaning', 'hardware', 'lowes'],
    utilities: ['electric', 'electricity', 'water bill', 'internet', 'phone', 'utility', 'comcast', 'verizon', 'bill'],
    rent: ['rent', 'landlord', 'mortgage', 'lease'],
    health: ['pharmacy', 'doctor', 'gym', 'dental', 'cvs', 'walgreens', 'clinic', 'hospital', 'yoga'],
    entertainment: ['netflix', 'spotify', 'cinema', 'movie', 'concert', 'steam', 'disney', 'hulu', 'tickets']
  };
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const KW_RE = Object.fromEntries(Object.entries(KW).map(([id, l]) => [id, l.map(k => [k, new RegExp('(^|[^a-z])' + esc(k) + '([^a-z]|$)', 'i')])]));

  const LS_TX = 'monemapa.tx.v1', LS_RULES = 'monemapa.rules.v1';
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const iso = t => t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  const uid = () => 'tx_' + Math.random().toString(36).slice(2, 10);

  function seed() {
    const ago = n => { const t = new Date(); t.setDate(t.getDate() - n); return iso(t); };
    return [
      [0, 'expense', 12.8, 'Blue Bottle Coffee', 'coffee', 'ai', 'coffee', .93],
      [1, 'expense', 38.2, 'Uber to airport', 'transport', 'ai', 'transport', .94],
      [1, 'expense', 42.5, 'Lunch with team', 'dining', 'ai', 'dining', .91],
      [2, 'income', 4200, 'Salary — Acme Ltd', 'salary', 'ai', 'salary', .95],
      [3, 'expense', 86.45, 'Whole Foods Market', 'groceries', 'ai', 'groceries', .96],
      [4, 'expense', 214, 'IKEA', 'household', 'user', 'shopping', .64],
      [6, 'expense', 15.99, 'Netflix', 'entertainment', 'ai', 'entertainment', .9],
      [8, 'expense', 1650, 'Rent', 'rent', 'ai', 'rent', .92],
      [10, 'income', 640, 'Invoice #1042 — Studio Nord', 'freelance', 'ai', 'freelance', .9],
      [12, 'expense', 24.3, 'CVS Pharmacy', 'health', 'ai', 'health', .93],
      [15, 'expense', 92.1, 'Comcast internet', 'utilities', 'ai', 'utilities', .95],
      [18, 'expense', 57.9, 'Trader Joe’s', 'groceries', 'ai', 'groceries', .94],
      [24, 'expense', 129, 'Amazon', 'shopping', 'ai', 'shopping', .88],
      [33, 'income', 4200, 'Salary — Acme Ltd', 'salary', 'ai', 'salary', .95],
      [38, 'expense', 1650, 'Rent', 'rent', 'ai', 'rent', .92],
      [41, 'expense', 310, 'Hotel — Lisbon', 'travel', 'ai', 'travel', .9]
    ].map(([d, type, amount, description, categoryId, categorySource, aiSuggested, aiConfidence], i) => ({
      id: uid(), type, amount, description, date: ago(d), categoryId, categorySource, aiSuggested, aiConfidence,
      note: '', createdAt: Date.now() - d * 864e5 - i, updatedAt: Date.now() - d * 864e5 - i
    }));
  }

  let txs = load(LS_TX, null) || seed();
  let rules = load(LS_RULES, [{ pattern: 'ikea', categoryId: 'household', createdAt: Date.now() - 4 * 864e5 }]);
  const persist = () => { try { localStorage.setItem(LS_TX, JSON.stringify(txs)); localStorage.setItem(LS_RULES, JSON.stringify(rules)); } catch (e) {} };

  // Six months of recurring history so dashboard trends have data
  function history() {
    let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const now = new Date(), monthStart = new Date(now.getFullYear(), now.getMonth(), 1), out = [];
    const add = (y, m, day, type, amount, description, categoryId) => {
      const t = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
      if (t >= monthStart) return;
      out.push({ id: uid(), type, amount: Math.round(amount * 100) / 100, description, date: iso(t), categoryId, categorySource: 'ai', aiSuggested: categoryId, aiConfidence: .9, note: '', createdAt: t.getTime(), updatedAt: t.getTime() });
    };
    for (let k = 1; k <= 6; k++) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1), y = d.getFullYear(), m = d.getMonth();
      if (k > 1) { add(y, m, 1, 'income', 4200, 'Salary — Acme Ltd', 'salary'); add(y, m, 1, 'expense', 1650, 'Rent', 'rent'); }
      if (rnd() > .3) add(y, m, 12, 'income', 300 + rnd() * 900, 'Invoice — freelance client', 'freelance');
      if (k % 3 === 0) add(y, m, 20, 'income', 85 + rnd() * 60, 'Dividend — index fund', 'investments');
      [4, 11, 18, 26].forEach(dd => add(y, m, dd, 'expense', 55 + rnd() * 70, pick(['Whole Foods Market', 'Trader Joe’s', 'Costco']), 'groceries'));
      [7, 15, 22].forEach(dd => add(y, m, dd, 'expense', 22 + rnd() * 50, pick(['Dinner — Bistro 42', 'Sushi Ko', 'Lunch with team']), 'dining'));
      [3, 9, 17, 24].forEach(dd => add(y, m, dd, 'expense', 12 + rnd() * 30, pick(['Uber', 'Metro card', 'Shell fuel']), 'transport'));
      [2, 10, 19].forEach(dd => add(y, m, dd, 'expense', 4 + rnd() * 9, pick(['Blue Bottle Coffee', 'Starbucks']), 'coffee'));
      add(y, m, 14, 'expense', 88 + rnd() * 20, 'Comcast internet', 'utilities');
      add(y, m, 6, 'expense', 15.99, 'Netflix', 'entertainment');
      if (rnd() > .4) add(y, m, 21, 'expense', 40 + rnd() * 160, pick(['Amazon', 'Target', 'Zara']), 'shopping');
      if (rnd() > .6) add(y, m, 13, 'expense', 20 + rnd() * 60, 'CVS Pharmacy', 'health');
      if (k === 4) add(y, m, 16, 'expense', 420, 'Flight — Chicago', 'travel');
    }
    return out;
  }
  const HIST = 'monemapa.hist.v2';
  if (!load(HIST, false)) { txs = txs.concat(history()); try { localStorage.setItem(HIST, 'true'); } catch (e) {} }
  persist();

  const listeners = new Set();
  const emit = (type, payload) => listeners.forEach(fn => { try { fn({ type, payload }); } catch (e) { console.error(e); } });

  const STOP = new Set(['to', 'for', 'at', 'with', 'the', 'from', 'in', 'on', 'and', 'of']);
  function merchantKey(desc) {
    const head = String(desc || '').split(/\s[—–-]\s|#/)[0].toLowerCase().replace(/[^\p{L}\p{N}&' ]+/gu, ' ');
    const out = [];
    for (const w of head.split(/\s+/).filter(Boolean)) { if (STOP.has(w) || /^\d/.test(w)) break; out.push(w); if (out.length === 2) break; }
    return out.join(' ');
  }

  function suggestSync({ description, type }) {
    const text = ' ' + String(description || '').toLowerCase() + ' ';
    const allowed = c => !!c && (c.type === 'both' || !type || c.type === type);
    const key = merchantKey(description), scores = {};
    for (const [id, list] of Object.entries(KW_RE)) {
      if (!allowed(byId[id])) continue;
      for (const [kw, re] of list) if (re.test(text)) scores[id] = (scores[id] || 0) + kw.length + 4;
    }
    if (key) {
      const counts = {};
      txs.forEach(t => { if (t.categorySource === 'user' && merchantKey(t.description) === key && allowed(byId[t.categoryId])) counts[t.categoryId] = (counts[t.categoryId] || 0) + 1; });
      for (const [id, n] of Object.entries(counts)) scores[id] = (scores[id] || 0) + 6 * n;
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    let out = ranked.map(([id, sc], i) => {
      const top = ranked[0][1], base = Math.min(.97, 1 - Math.exp(-top / 9));
      return { categoryId: id, confidence: +(i === 0 ? base : base * (sc / top) * .75).toFixed(2), source: 'model' };
    });
    const rule = key && rules.find(r => key === r.pattern || key.startsWith(r.pattern + ' '));
    if (rule && allowed(byId[rule.categoryId])) { out = out.filter(o => o.categoryId !== rule.categoryId); out.unshift({ categoryId: rule.categoryId, confidence: .99, source: 'rule' }); }
    if (!out.length) out.push({ categoryId: 'other', confidence: .35, source: 'model' });
    if (out.length < 3) {
      const freq = {};
      txs.forEach(t => { if (t.type === type) freq[t.categoryId] = (freq[t.categoryId] || 0) + 1; });
      Object.entries(freq).sort((a, b) => b[1] - a[1]).forEach(([id]) => { if (out.length < 3 && !out.some(o => o.categoryId === id)) out.push({ categoryId: id, confidence: .15, source: 'history' }); });
    }
    return out.slice(0, 3);
  }

  window.MoneMapaTx = {
    version: '1.0.0',
    categories: type => CATS.filter(c => !type || c.type === 'both' || c.type === type),
    category: id => byId[id] || byId.other,
    list: () => txs.slice(),
    create(input) { const tx = { id: uid(), note: '', ...input, createdAt: Date.now(), updatedAt: Date.now() }; txs.unshift(tx); persist(); emit('tx.created', tx); return tx; },
    update(id, patch) { let tx; txs = txs.map(t => t.id === id ? (tx = { ...t, ...patch, id, updatedAt: Date.now() }) : t); persist(); emit('tx.updated', tx); return tx; },
    remove(id) { const tx = txs.find(t => t.id === id); txs = txs.filter(t => t.id !== id); persist(); emit('tx.deleted', tx); return tx; },
    restore(tx) { if (!txs.some(t => t.id === tx.id)) txs.push(tx); persist(); emit('tx.restored', tx); return tx; },
    suggestCategory: q => new Promise(r => setTimeout(() => r(suggestSync(q)), 260 + Math.random() * 220)),
    learnRule(pattern, categoryId) { if (!pattern) return; rules = rules.filter(r => r.pattern !== pattern).concat({ pattern, categoryId, createdAt: Date.now() }); persist(); emit('rule.learned', { pattern, categoryId }); },
    rules: () => rules.slice(),
    merchantKey,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset() { txs = seed().concat(history()); rules = [{ pattern: 'ikea', categoryId: 'household', createdAt: Date.now() }]; persist(); emit('tx.reset', null); }
  };
})();
