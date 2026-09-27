/**
 * Transactions page ("Transaction Tracking" design).
 *
 *  - List: month picker, type tabs, category filter and search; a table on
 *    wide screens and a list grouped by day on narrow ones.
 *  - Add / edit: side panel (wide) or bottom sheet (narrow). Categories are
 *    suggested by the server (saved rules + keyword model); overriding a
 *    suggestion can save a rule ("Always categorize …").
 *  - Delete with confirmation, and Undo in the toast.
 *  - Deep link: ?add=income | ?add=expense opens the Add panel with that
 *    type (used by the dashboard's "+" buttons).
 *
 * Session, header, navigation and the Desktop/Mobile toolbar come from the
 * shared finance shell.
 */
import { h, replaceChildren, svg } from '../core/dom.js';
import { alertBox } from '../components/ui.js';
import { initShell } from '../finance/shell.js';
import { loadTransactionsStore } from '../finance/transactions-store.js';

const $ = (id) => document.getElementById(id);
const SUGGEST_DELAY_MS = 380;
const TOAST_MS = 5000;

let config;
let money; // formatters for config.finance.currency
let S; // transactions store (server-backed, see ../finance/transactions-store.js)

const state = {
  ym: { y: new Date().getFullYear(), m: new Date().getMonth() },
  type: 'all',
  cat: 'all',
  q: '',
  txs: [],
  cats: [],
};

// --- Helpers -------------------------------------------------------------------

const isoDate = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
const monthKey = () => `${state.ym.y}-${String(state.ym.m + 1).padStart(2, '0')}`;
const monthDate = () => new Date(state.ym.y, state.ym.m, 1);

function categoryOf(id) {
  return state.cats.find((c) => c.id === id) || state.cats.find((c) => c.id === 'other') || { name: '—', color: '#8c8fa1' };
}

function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "✦ AI" / "✦ Rule" badge for how a category was chosen. */
function badgeOf(t) {
  if (t.categorySource === 'ai') return { text: '✦ AI', title: `Suggested by AI${t.aiConfidence ? ` · ${Math.round(t.aiConfidence * 100)}% confidence` : ''}` };
  if (t.categorySource === 'rule') return { text: '✦ Rule', title: 'Set by your saved rule' };
  return null;
}

const dot = (color, size = 8) => h('span', { class: 'ai-chip__dot', style: { background: color, width: `${size}px`, height: `${size}px` } });

// --- List ----------------------------------------------------------------------

function monthTransactions() {
  return state.txs.filter((t) => t.date.startsWith(monthKey()));
}

function filteredTransactions(month) {
  const q = state.q.trim().toLowerCase();
  return month
    .filter(
      (t) =>
        (state.type === 'all' || t.type === state.type) &&
        (state.cat === 'all' || t.categoryId === state.cat) &&
        (!q || t.description.toLowerCase().includes(q) || categoryOf(t.categoryId).name.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function render() {
  const month = monthTransactions();
  const inc = month.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const exp = month.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const net = inc - exp;
  const monthName = monthDate().toLocaleDateString(undefined, { month: 'long' });
  const monthLong = monthDate().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const netText = `${net < 0 ? '− ' : ''}${money.format(Math.abs(net))}`;

  $('month-label').textContent = monthLong;

  // Summary: 3 cards (wide) + combined card (narrow); CSS shows one.
  const card = (label, value, cls = '') =>
    h('div', { class: 'tx-summary__card' }, h('div', { class: 'tx-summary__label' }, `${label} · ${monthName}`), h('div', { class: `tx-summary__value ${cls}` }, value));
  replaceChildren(
    $('summary'),
    h('div', { class: 'tx-summary' }, card('Income', money.format(inc), 'is-good'), card('Expenses', money.format(exp), 'is-bad-soft'), card('Net', netText)),
    h(
      'div',
      { class: 'tx-net' },
      h('div', { class: 'tx-summary__label' }, `Net · ${monthName}`),
      h('div', { class: 'tx-net__value' }, netText),
      h('div', { class: 'tx-net__split' }, h('span', { class: 'is-good' }, `In ${money.format(inc)}`), h('span', { class: 'is-bad-soft' }, `Out ${money.format(exp)}`)),
    ),
  );

  const rows = filteredTransactions(month);
  if (!rows.length) return renderEmpty(monthLong);
  replaceChildren($('results'), renderTable(rows), renderGroups(rows));
}

function renderEmpty(monthLong) {
  const filtered = state.type !== 'all' || state.cat !== 'all' || state.q.trim();
  const action = filtered
    ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: clearFilters }, 'Clear filters')
    : h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => openAdd() }, 'Add transaction');
  replaceChildren(
    $('results'),
    h(
      'div',
      { class: 'tx-empty' },
      h('div', { class: 'tx-empty__title' }, filtered ? 'No matching transactions' : `Nothing recorded in ${monthLong}`),
      h('div', { class: 'tx-empty__body' }, filtered ? 'Try a different search or clear the filters.' : 'Add your first income or expense for this month.'),
      action,
    ),
  );
}

const editIcon =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const deleteIcon =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

function iconButton(label, iconSvg, onClick, danger) {
  return h(
    'button',
    { type: 'button', class: `icon-btn${danger ? ' icon-btn--danger' : ''}`, 'aria-label': label, title: label.split(' ')[0], onClick },
    svg(iconSvg),
  );
}

function renderTable(rows) {
  return h(
    'div',
    { class: 'tx-table', role: 'table', 'aria-label': 'Transactions' },
    h(
      'div',
      { class: 'tx-table__row tx-table__row--head', role: 'row' },
      h('span', { role: 'columnheader' }, 'Date'),
      h('span', { role: 'columnheader' }, 'Description'),
      h('span', { role: 'columnheader' }, 'Category'),
      h('span', { role: 'columnheader', style: { textAlign: 'right' } }, 'Amount'),
      h('span', { role: 'columnheader' }, h('span', { class: 'visually-hidden' }, 'Actions')),
    ),
    rows.map((t) => {
      const c = categoryOf(t.categoryId);
      const badge = badgeOf(t);
      return h(
        'div',
        { class: 'tx-table__row', role: 'row' },
        h('span', { class: 'tx-date', role: 'cell' }, shortDate(t.date)),
        h(
          'div',
          { class: 'tx-cell-desc', role: 'cell' },
          h('span', { class: 'ellipsis', style: { fontWeight: 600 } }, t.description),
          t.note && h('span', { class: 'ellipsis tx-note-line' }, t.note),
        ),
        h(
          'div',
          { class: 'tx-cat', role: 'cell' },
          h('span', { class: 'chip ellipsis', style: { background: `${c.color}1f` } }, dot(c.color), c.name),
          badge && h('span', { class: 'badge-ai', title: badge.title }, badge.text),
        ),
        h('span', { class: `tx-amount-cell ${t.type === 'income' ? 'is-good' : ''}`, role: 'cell' }, money.signed(t.amount, t.type)),
        h(
          'div',
          { class: 'tx-row-actions', role: 'cell' },
          iconButton(`Edit ${t.description}`, editIcon, () => openEdit(t)),
          iconButton(`Delete ${t.description}`, deleteIcon, () => removeTx(t.id), true),
        ),
      );
    }),
  );
}

function renderGroups(rows) {
  const today = isoDate(new Date());
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yesterday = isoDate(yest);

  const byDay = {};
  rows.forEach((t) => (byDay[t.date] ??= []).push(t));

  return h(
    'div',
    { class: 'tx-groups' },
    Object.keys(byDay)
      .sort()
      .reverse()
      .map((d) => {
        const items = byDay[d];
        const net = items.reduce((a, t) => a + (t.type === 'income' ? t.amount : -t.amount), 0);
        const [y, m, dd] = d.split('-').map(Number);
        const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        return h(
          'div',
          { class: 'tx-group' },
          h('div', { class: 'tx-group__head' }, h('span', {}, label), h('span', {}, `${net >= 0 ? '+ ' : '− '}${money.format(Math.abs(net))}`)),
          h(
            'div',
            { class: 'tx-group__items' },
            items.map((t) => {
              const c = categoryOf(t.categoryId);
              const badge = badgeOf(t);
              return h(
                'button',
                { type: 'button', class: 'tx-item', 'aria-label': `Edit ${t.description}`, onClick: () => openEdit(t) },
                h('span', { class: 'tx-item__icon', style: { background: `${c.color}1f` } }, dot(c.color, 10)),
                h(
                  'span',
                  { class: 'tx-item__body' },
                  h('span', { class: 'tx-item__desc ellipsis' }, t.description),
                  h('span', { class: 'tx-item__meta' }, badge ? `${c.name} · ${badge.text}` : c.name),
                ),
                h('span', { class: `tx-item__amount ${t.type === 'income' ? 'is-good' : ''}` }, money.signed(t.amount, t.type)),
              );
            }),
          ),
        );
      }),
  );
}

function clearFilters() {
  state.type = 'all';
  state.cat = 'all';
  state.q = '';
  $('cat-filter').value = 'all';
  $('search').value = '';
  syncTypeTabs();
  render();
}

function syncTypeTabs() {
  $('type-tabs').querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.type === state.type)));
}

function shiftMonth(delta) {
  const d = new Date(state.ym.y, state.ym.m + delta, 1);
  state.ym = { y: d.getFullYear(), m: d.getMonth() };
  render();
}

// --- Editor --------------------------------------------------------------------

const blankEditor = () => ({
  open: false,
  mode: 'add',
  id: null,
  type: 'expense',
  cat: '',
  sugs: [],
  aiPick: null,
  aiConf: null,
  aiSource: null,
  userPicked: false,
  opener: null,
});
let ed = blankEditor();
let suggestTimer = null;
let suggestRequest = 0;

const fields = () => ({ amount: $('tx-amount'), desc: $('tx-desc'), cat: $('tx-cat'), date: $('tx-date'), note: $('tx-note'), learn: $('learn-rule') });

function setError(name, message) {
  $(`err-${name}`).textContent = message || '';
  const input = { amount: 'tx-amount', desc: 'tx-desc', cat: 'tx-cat', date: 'tx-date' }[name];
  $(input).setAttribute('aria-invalid', message ? 'true' : 'false');
}

function clearErrors() {
  ['amount', 'desc', 'cat', 'date'].forEach((n) => setError(n, ''));
}

function fillCategoryOptions() {
  const select = $('tx-cat');
  replaceChildren(
    select,
    h('option', { value: '' }, 'Choose a category…'),
    S.categories(ed.type).map((c) => h('option', { value: c.id }, c.name)),
  );
  select.value = ed.cat;
}

function syncTypeRadios() {
  $('type-radios').querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === ed.type)));
}

function renderSuggestions() {
  const showConfidence = config.transactions?.showConfidence ?? true;
  $('ai-box').hidden = !ed.sugs.length || !$('ai-loading').hidden;
  replaceChildren(
    $('ai-chips'),
    ed.sugs.map((sg) => {
      const c = categoryOf(sg.categoryId);
      const selected = ed.cat === sg.categoryId;
      return h(
        'button',
        { type: 'button', class: 'ai-chip', 'aria-pressed': String(selected), onClick: () => pickCategory(sg.categoryId) },
        dot(c.color),
        h('span', {}, c.name),
        showConfidence && h('span', { class: 'ai-chip__conf' }, sg.source === 'rule' ? 'rule' : `${Math.round(sg.confidence * 100)}%`),
      );
    }),
  );

  // "AI suggested X — you chose Y" + optional rule.
  const overridden = Boolean(ed.userPicked && ed.aiPick && ed.cat && ed.cat !== ed.aiPick);
  $('override').hidden = !overridden;
  if (overridden) {
    const chosen = categoryOf(ed.cat).name;
    replaceChildren($('override-text'), 'AI suggested ', h('strong', {}, categoryOf(ed.aiPick).name), ' — you chose ', h('strong', {}, chosen), '.');
    $('learn-text').textContent = `Always categorize “${S.merchantKey($('tx-desc').value)}” as ${chosen}`;
  }
}

function setLoading(loading) {
  $('ai-loading').hidden = !loading;
  renderSuggestions();
}

async function runSuggest(description, type, keepPick) {
  const req = ++suggestRequest;
  setLoading(true);
  let sugs = [];
  try {
    sugs = await S.suggestCategory({ description, type }); // server: rules + keyword model
  } catch {
    /* suggestions are optional — the user can still pick a category */
  }
  if (req !== suggestRequest || !ed.open) return; // superseded or closed
  ed.sugs = sugs;
  const top = sugs[0];
  if (!keepPick) {
    ed.aiPick = top?.categoryId ?? null;
    ed.aiConf = top?.confidence ?? null;
    ed.aiSource = top?.source ?? null;
    // Apply the top suggestion unless the user already chose something.
    if (top && !ed.userPicked && (config.transactions?.autoApplyAI ?? true)) {
      ed.cat = top.categoryId;
      $('tx-cat').value = ed.cat;
      setError('cat', '');
    }
    if (ed.userPicked && top && ed.cat === top.categoryId) ed.userPicked = false;
  }
  setLoading(false);
}

function onDescriptionInput() {
  const value = $('tx-desc').value;
  setError('desc', '');
  clearTimeout(suggestTimer);
  if (value.trim().length < 3) {
    suggestRequest++;
    ed.sugs = [];
    if (!ed.userPicked) ed.aiPick = null;
    setLoading(false);
    return;
  }
  $('ai-loading').hidden = false;
  $('ai-box').hidden = true;
  suggestTimer = setTimeout(() => runSuggest(value, ed.type), SUGGEST_DELAY_MS);
}

function pickCategory(id) {
  ed.cat = id;
  ed.userPicked = Boolean(id) && id !== ed.aiPick;
  $('tx-cat').value = id;
  $('learn-rule').checked = false;
  setError('cat', '');
  renderSuggestions();
}

function setType(type) {
  if (ed.type === type) return;
  const current = ed.cat && S.category(ed.cat);
  const keep = current && (current.type === 'both' || current.type === type);
  ed.type = type;
  if (!keep) {
    ed.cat = '';
    ed.userPicked = false;
  }
  ed.sugs = [];
  ed.aiPick = null;
  syncTypeRadios();
  fillCategoryOptions();
  renderSuggestions();
  const desc = $('tx-desc').value;
  if (desc.trim().length >= 3) runSuggest(desc, type);
}

function showConfirm(on) {
  $('confirm').hidden = !on;
  $('actions').hidden = on;
  if (on) $('keep').focus();
}

function openEditor(next) {
  ed = { ...blankEditor(), ...next, open: true, opener: document.activeElement };
  const f = fields();
  f.amount.value = next.amount ?? '';
  f.desc.value = next.desc ?? '';
  f.date.value = next.date ?? isoDate(new Date());
  f.note.value = next.note ?? '';
  f.learn.checked = false;
  // Leave room for the currency symbol (e.g. "AED") inside the amount field.
  $('cur-symbol').textContent = money.symbol;
  $('tx-amount').style.paddingLeft = `${$('cur-symbol').offsetWidth + 22}px`;

  const editing = ed.mode === 'edit';
  $('editor-title').textContent = editing ? 'Edit transaction' : 'Add transaction';
  $('save').textContent = editing ? 'Save changes' : 'Add transaction';
  $('delete-btn').hidden = !editing;
  $('confirm-text').textContent = ` It will be removed from ${monthDate().toLocaleDateString(undefined, { month: 'long' })} totals.`;
  showConfirm(false);
  clearErrors();
  syncTypeRadios();
  fillCategoryOptions();
  setLoading(false);

  $('backdrop').classList.add('is-open');
  $('editor').classList.add('is-open');
  $('editor').setAttribute('aria-hidden', 'false');
  setTimeout(() => (editing ? f.desc : f.amount).focus(), 330); // after the slide-in
}

/**
 * Open the Add panel. `category` (from ?category=) is preselected when it fits
 * the type; it then counts as the user's choice, so AI won't replace it.
 */
function openAdd(type = 'expense', category = null) {
  if (!S) return;
  const c = category && S.category(category);
  const fits = c && c.id === category && (c.type === 'both' || c.type === type);
  openEditor({ mode: 'add', type, ...(fits ? { cat: category, userPicked: true } : {}) });
}

function openEdit(t) {
  openEditor({
    mode: 'edit',
    id: t.id,
    type: t.type,
    amount: String(t.amount),
    desc: t.description,
    date: t.date,
    note: t.note || '',
    cat: t.categoryId,
    aiPick: t.aiSuggested || null,
    aiConf: t.aiConfidence || null,
    aiSource: t.categorySource === 'rule' ? 'rule' : 'model',
    userPicked: t.categorySource === 'user',
  });
  if (t.description) runSuggest(t.description, t.type, true);
}

function closeEditor() {
  if (!ed.open) return;
  clearTimeout(suggestTimer);
  suggestRequest++;
  ed.open = false;
  $('backdrop').classList.remove('is-open');
  $('editor').classList.remove('is-open');
  $('editor').setAttribute('aria-hidden', 'true');
  ed.opener?.focus?.();
}

async function save(event) {
  event.preventDefault();
  if ($('save').disabled) return; // already saving
  const f = fields();
  const amount = parseFloat(f.amount.value.replace(/[^0-9.]/g, ''));
  const errors = {
    amount: amount > 0 ? '' : 'Enter an amount greater than 0.',
    desc: f.desc.value.trim() ? '' : 'Add a short description.',
    cat: ed.cat ? '' : 'Choose a category.',
    date: f.date.value ? '' : 'Pick a date.',
  };
  Object.entries(errors).forEach(([k, v]) => setError(k, v));
  const firstError = Object.keys(errors).find((k) => errors[k]);
  if (firstError) {
    ({ amount: f.amount, desc: f.desc, cat: f.cat, date: f.date })[firstError].focus();
    return;
  }

  const usedAi = !ed.userPicked && ed.aiPick === ed.cat;
  const input = {
    type: ed.type,
    amount: Math.round(amount * 100) / 100,
    description: f.desc.value.trim(),
    date: f.date.value,
    categoryId: ed.cat,
    note: f.note.value.trim(),
    categorySource: usedAi ? (ed.aiSource === 'rule' ? 'rule' : 'ai') : 'user',
    aiSuggested: ed.aiPick,
    aiConfidence: ed.aiConf,
  };
  const learned = f.learn.checked && ed.userPicked;
  const adding = ed.mode === 'add';

  const saveBtn = $('save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    if (adding) await S.create(input);
    else await S.update(ed.id, input);
    if (learned) await S.learnRule(S.merchantKey(input.description), ed.cat);
  } catch (err) {
    showServerErrors(err);
    return;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = adding ? 'Add transaction' : 'Save changes';
  }

  // Show the month the transaction belongs to.
  const [y, m] = input.date.split('-').map(Number);
  state.ym = { y, m: m - 1 };
  closeEditor();
  render();
  showToast(`${adding ? 'Transaction added' : 'Changes saved'}${learned ? ' · rule learned' : ''}`);
}

/** Put the server's validation messages next to the fields (or in a toast). */
function showServerErrors(err) {
  const map = { amount: 'amount', description: 'desc', categoryId: 'cat', date: 'date' };
  const fieldErrors = err.code === 'INVALID' ? err.details.fields ?? {} : {};
  let shown = false;
  for (const [apiField, uiField] of Object.entries(map)) {
    if (fieldErrors[apiField]) {
      setError(uiField, fieldErrors[apiField]);
      shown = true;
    }
  }
  if (!shown) showToast(err.message || "Couldn't save. Please try again.");
}

async function removeTx(id) {
  try {
    const tx = await S.remove(id);
    showToast(`“${tx.description}” deleted`, tx);
  } catch (err) {
    showToast(err.message || "Couldn't delete. Please try again.");
  }
}

// --- Toast ---------------------------------------------------------------------

let toastTimer = null;
let undoTx = null;

function showToast(message, restorable = null) {
  clearTimeout(toastTimer);
  undoTx = restorable;
  $('toast-text').textContent = message;
  $('undo').hidden = !restorable;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => ($('toast').hidden = true), TOAST_MS);
}

// --- Boot ----------------------------------------------------------------------

function wireEvents() {
  $('prev-month').addEventListener('click', () => shiftMonth(-1));
  $('next-month').addEventListener('click', () => shiftMonth(1));
  $('type-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    state.type = b.dataset.type;
    syncTypeTabs();
    render();
  });
  $('cat-filter').addEventListener('change', (e) => {
    state.cat = e.target.value;
    render();
  });
  $('search').addEventListener('input', (e) => {
    state.q = e.target.value;
    render();
  });
  $('add-btn').addEventListener('click', () => openAdd());
  $('fab').addEventListener('click', () => openAdd());

  // Editor
  $('editor').addEventListener('submit', save);
  $('editor-close').addEventListener('click', closeEditor);
  $('cancel').addEventListener('click', closeEditor);
  $('backdrop').addEventListener('click', closeEditor);
  $('type-radios').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (b) setType(b.dataset.type);
  });
  $('tx-amount').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9.,]/g, '');
    setError('amount', '');
  });
  $('tx-desc').addEventListener('input', onDescriptionInput);
  $('tx-cat').addEventListener('change', (e) => pickCategory(e.target.value));
  $('tx-date').addEventListener('input', () => setError('date', ''));
  $('use-suggestion').addEventListener('click', () => pickCategory(ed.aiPick));
  $('delete-btn').addEventListener('click', () => showConfirm(true));
  $('keep').addEventListener('click', () => showConfirm(false));
  $('confirm-delete').addEventListener('click', () => {
    const id = ed.id;
    closeEditor();
    removeTx(id);
  });
  $('undo').addEventListener('click', async () => {
    const tx = undoTx;
    undoTx = null;
    clearTimeout(toastTimer);
    $('toast').hidden = true;
    if (!tx) return;
    try {
      await S.restore(tx);
    } catch (err) {
      showToast(err.message || "Couldn't undo. Please try again.");
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ed.open) closeEditor();
  });
}

/** ?add=income|expense (from the dashboard "+" buttons) opens the Add panel. */
/**
 * Deep links (from the dashboard):
 *   ?month=YYYY-MM                      show that month ("View all")
 *   ?add=income|expense[&category=id]   open the Add panel ("+" buttons,
 *                                       targets set in config.dashboard.addTransactionLinks)
 * The add/category params are removed afterwards so a reload doesn't reopen the panel.
 */
function handleDeepLink() {
  const params = new URLSearchParams(location.search);

  const month = params.get('month');
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) {
    const [y, m] = month.split('-').map(Number);
    state.ym = { y, m: m - 1 };
    render();
  }

  const add = params.get('add');
  if (add !== 'income' && add !== 'expense') return;
  const category = params.get('category');
  params.delete('add');
  params.delete('category');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
  openAdd(add, category);
}

async function main() {
  const shell = await initShell({
    kicker: 'finance/transactions v1.0',
    title: 'Transactions',
    onReset: async () => {
      // Reload from the server, back to this month with no filters.
      state.ym = { y: new Date().getFullYear(), m: new Date().getMonth() };
      if (S) {
        clearFilters();
        await S.reload();
      }
    },
  });
  if (!shell) return; // redirecting to sign-in
  ({ config, money } = shell);

  // The signed-in user's transactions, categories and rules from the server.
  S = await loadTransactionsStore();
  state.cats = S.categories();
  state.txs = S.list();
  S.subscribe(() => {
    state.txs = S.list();
    render();
  });

  replaceChildren($('cat-filter'), h('option', { value: 'all' }, 'All categories'), state.cats.map((c) => h('option', { value: c.id }, c.name)));
  $('editor').hidden = false; // shown/hidden by class from now on (keeps the slide animation)
  $('editor').setAttribute('aria-hidden', 'true');

  wireEvents();
  render();
  $('main').removeAttribute('aria-busy');
  handleDeepLink();
}

main().catch((err) => {
  const slot = $('error');
  slot.hidden = false;
  replaceChildren(slot, alertBox({ title: "We couldn't load your transactions", body: err.message, action: { label: 'Try again →', onClick: () => location.reload() } }));
});
