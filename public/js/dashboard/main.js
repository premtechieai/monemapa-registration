/**
 * Dashboard page.
 *
 * Session, header, navigation and the Desktop/Mobile toolbar come from the
 * shared finance shell (../finance/shell.js): the page is only served to
 * signed-in users and reuses the login session.
 *
 * Data: the user's transactions from the server (../finance/transactions-store.js). Totals, trends and
 * charts are computed per selected month, following the dashboard design.
 * The Income/Spending "+" buttons open the Transactions page's Add panel.
 */
import { h, replaceChildren, svg } from '../core/dom.js';
import { alertBox } from '../components/ui.js';
import { initShell, routeUrl } from '../finance/shell.js';
import { loadTransactionsStore } from '../finance/transactions-store.js';
import { barChart, donut, lineChart, niceMax } from './charts.js';

const $ = (id) => document.getElementById(id);

const state = {
  ym: { y: new Date().getFullYear(), m: new Date().getMonth() },
  txs: [],
  cats: [],
};

let config;
let fmt; // Intl.NumberFormat for config.finance.currency
let compact; // v => "AED 2.4K"

/** Transactions page with the "Add" panel open for this type (routes.transactions). */
const addUrl = (type) => routeUrl(config, 'transactions', { add: type });

// --- Data helpers -----------------------------------------------------------------

const monthKey = (y, m) => {
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const inMonth = (y, m) => state.txs.filter((t) => t.date.startsWith(monthKey(y, m)));
const sum = (txs, type) => txs.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);

function categoryOf(id) {
  const map = Object.fromEntries(state.cats.map((c) => [c.id, c]));
  return map[id] || map.other || { name: 'Other', color: '#8c8fa1' };
}

/** Cumulative daily spend: [[1, total], [2, total], ...]. */
function cumulative(txs, days) {
  const perDay = Array(days + 1).fill(0);
  txs.filter((t) => t.type === 'expense').forEach((t) => (perDay[+t.date.slice(8, 10)] += t.amount));
  const out = [];
  let running = 0;
  for (let d = 1; d <= days; d++) out.push([d, (running += perDay[d])]);
  return out;
}

const empty = (text) => h('div', { class: 'empty' }, text);

// --- Render -------------------------------------------------------------------------

function render() {
  const { y, m } = state.ym;
  const prevDate = new Date(y, m - 1, 1);
  const monthLabel = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const monthShort = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'short' });
  const prevShort = prevDate.toLocaleDateString(undefined, { month: 'short' });

  const cur = inMonth(y, m);
  const prev = inMonth(y, m - 1);
  const inc = sum(cur, 'income'), exp = sum(cur, 'expense');
  const pInc = sum(prev, 'income'), pExp = sum(prev, 'expense');

  $('month-label').textContent = monthLabel;
  $('subtitle').textContent = `Here's your ${monthLabel} at a glance.`;
  document.querySelectorAll('[data-month-label]').forEach((el) => (el.textContent = monthLabel));

  renderKpis({ inc, exp, pInc, pExp, prevShort });
  renderBars(y, m);
  renderCategories(cur, exp, monthLabel);
  renderPace({ y, m, cur, prev, monthShort, prevShort });
  renderSources(cur, inc, monthLabel);
  renderRecent(cur);
}

function renderKpis({ inc, exp, pInc, pExp, prevShort }) {
  const net = inc - exp;
  const rate = inc > 0 ? net / inc : 0;
  const pNet = pInc - pExp;
  const pRate = pInc > 0 ? pNet / pInc : null;

  /** "▲ 4.2% vs Aug", coloured good/bad depending on direction. */
  const delta = (a, b, upIsGood) => {
    if (!b) return { text: `No data for ${prevShort}`, cls: '' };
    const d = (a - b) / b;
    const up = d >= 0;
    const cls = Math.abs(d) < 0.005 ? '' : up === upIsGood ? 'is-good' : 'is-bad';
    return { text: `${up ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(1)}% vs ${prevShort}`, cls };
  };

  const cards = [
    { label: 'Income', dot: '#40a02b', value: fmt.format(inc), delta: delta(inc, pInc, true), add: 'income' },
    { label: 'Spending', dot: '#8839ef', value: fmt.format(exp), delta: delta(exp, pExp, false), add: 'expense' },
    {
      label: 'Net savings',
      dot: '#1e66f5',
      value: `${net < 0 ? '− ' : ''}${fmt.format(Math.abs(net))}`,
      valueCls: net < 0 ? 'is-bad' : 'is-good',
      delta: { text: pInc ? `${net - pNet >= 0 ? '▲' : '▼'} ${fmt.format(Math.abs(net - pNet))} vs ${prevShort}` : `No data for ${prevShort}`, cls: '' },
    },
    {
      label: 'Savings rate',
      dot: '#df8e1d',
      value: `${Math.round(rate * 100)}%`,
      delta: { text: pRate === null ? 'Share of income kept' : `${prevShort} was ${Math.round(pRate * 100)}%`, cls: '' },
      meter: Math.max(0, Math.min(100, rate * 100)),
    },
  ];

  replaceChildren(
    $('kpis'),
    cards.map((c) => {
      // "+" on Income and Spending opens the Transactions page with the Add
      // panel ready for that type (routes.transactions?add=income|expense).
      const label = c.add === 'income' ? 'Add income' : 'Add expense';
      return h(
        'div',
        { class: 'kpi' },
        h(
          'div',
          { class: 'kpi__head' },
          h('span', { class: 'kpi__label' }, h('span', { class: 'dot', style: { background: c.dot } }), c.label),
          c.add &&
            h(
              'a',
              { class: `kpi__add kpi__add--${c.add}`, href: addUrl(c.add), 'aria-label': label, title: label },
              svg('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'),
            ),
        ),
        h('div', { class: `kpi__value ${c.valueCls ?? ''}` }, c.value),
        h('div', { class: `kpi__delta ${c.delta.cls}` }, c.delta.text),
        c.meter != null && h('div', { class: 'meter' }, h('div', { class: 'meter__fill', style: { width: `${c.meter}%` } })),
      );
    }),
  );
}

function renderBars(y, m) {
  const series = [5, 4, 3, 2, 1, 0].map((k) => {
    const d = new Date(y, m - k, 1);
    const txs = inMonth(d.getFullYear(), d.getMonth());
    return {
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      full: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      inc: sum(txs, 'income'),
      exp: sum(txs, 'expense'),
      cur: k === 0,
    };
  });
  const max = niceMax(Math.max(1, ...series.map((p) => Math.max(p.inc, p.exp))));
  replaceChildren($('bar-chart'), barChart(series, { max, fmt, compact }));
}

function renderCategories(cur, exp, monthLabel) {
  if (exp <= 0) return replaceChildren($('categories'), empty(`No spending recorded for ${monthLabel}.`));

  const byCat = {};
  cur.filter((t) => t.type === 'expense').forEach((t) => (byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount));
  let segments = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => ({ id, v, name: categoryOf(id).name, color: categoryOf(id).color }));
  if (segments.length > 6) {
    const rest = segments.slice(5).reduce((a, x) => a + x.v, 0);
    segments = segments.slice(0, 5).concat({ id: '_rest', v: rest, name: 'Everything else', color: '#9ca0b0' });
  }

  // Hover on either the donut or the legend highlights the same category.
  let rows = [];
  const chart = donut(segments, { total: exp, compact, onHover: (id) => highlight(id) });
  function highlight(id) {
    chart.highlight(id);
    rows.forEach(([sg, row]) => row.classList.toggle('is-dim', Boolean(id) && sg.id !== id));
  }
  rows = segments.map((sg) => {
    const row = h(
      'div',
      { class: 'legend-row', onMouseenter: () => highlight(sg.id), onMouseleave: () => highlight(null) },
      h('span', { class: 'swatch', style: { background: sg.color } }),
      h('span', { class: 'legend-row__name' }, sg.name),
      h('span', { class: 'num' }, fmt.format(sg.v)),
      h('span', { class: 'legend-row__pct' }, `${Math.round((sg.v / exp) * 100)}%`),
    );
    return [sg, row];
  });

  replaceChildren(
    $('categories'),
    h(
      'div',
      { class: 'categories' },
      h('div', { class: 'categories__donut' }, chart.el),
      h('div', { class: 'categories__legend' }, rows.map(([, row]) => row)),
    ),
  );
}

function renderPace({ y, m, cur, prev, monthShort, prevShort }) {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m;
  const daysCur = new Date(y, m + 1, 0).getDate();
  const daysPrev = new Date(y, m, 0).getDate();
  const days = Math.max(daysCur, daysPrev);

  const upTo = isCurrentMonth ? today.getDate() : daysCur;
  const curPts = cumulative(cur, daysCur).slice(0, upTo);
  const prevPts = cumulative(prev, daysPrev);
  const max = niceMax(Math.max(1, ...curPts.map((p) => p[1]), ...prevPts.map((p) => p[1])));

  $('pace-cur').textContent = monthShort;
  $('pace-prev').textContent = prevShort;
  replaceChildren($('line-chart'), lineChart(curPts, prevPts, { days, max, compact }));

  const prevSameDay = prevPts.length ? prevPts[Math.min(upTo, prevPts.length) - 1][1] : 0;
  const now = curPts.length ? curPts[curPts.length - 1][1] : 0;
  let note = '';
  if (prevPts.length && prevSameDay) {
    note = isCurrentMonth
      ? `By day ${upTo} you've spent ${fmt.format(now)} — ${
          now <= prevSameDay ? `${fmt.format(prevSameDay - now)} less` : `${fmt.format(now - prevSameDay)} more`
        } than the same point in ${prevShort}.`
      : `Total ${fmt.format(now)} vs ${fmt.format(prevPts[prevPts.length - 1][1])} in ${prevShort}.`;
  }
  $('pace-note').textContent = note;
}

function renderSources(cur, inc, monthLabel) {
  if (inc <= 0) return replaceChildren($('sources'), empty(`No income recorded for ${monthLabel}.`));

  const bySource = {};
  cur.filter((t) => t.type === 'income').forEach((t) => (bySource[t.categoryId] = (bySource[t.categoryId] || 0) + t.amount));
  replaceChildren(
    $('sources'),
    h(
      'div',
      { class: 'sources' },
      Object.entries(bySource)
        .sort((a, b) => b[1] - a[1])
        .map(([id, v]) => {
          const c = categoryOf(id);
          return h(
            'div',
            {},
            h(
              'div',
              { class: 'source__head' },
              h('span', { class: 'legend-row__name' }, c.name),
              h('span', { class: 'num' }, `${fmt.format(v)} `, h('span', { class: 'legend-row__pct' }, `· ${Math.round((v / inc) * 100)}%`)),
            ),
            h('div', { class: 'meter source__bar' }, h('div', { class: 'meter__fill', style: { width: `${Math.max(2, (v / inc) * 100)}%`, background: c.color } })),
          );
        }),
    ),
  );
}

function renderRecent(cur) {
  const recent = cur
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .slice(0, 5);
  if (!recent.length) return replaceChildren($('recent'), empty('No transactions this month yet.'));

  replaceChildren(
    $('recent'),
    recent.map((t) => {
      const c = categoryOf(t.categoryId);
      const [yy, mm, dd] = t.date.split('-').map(Number);
      const date = new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const income = t.type === 'income';
      return h(
        'div',
        { class: 'tx' },
        h('span', { class: 'tx__icon', style: { background: `${c.color}1f` } }, h('span', { class: 'dot', style: { background: c.color, width: '10px', height: '10px' } })),
        h('div', { class: 'tx__body' }, h('span', { class: 'tx__desc' }, t.description), h('span', { class: 'tx__meta' }, `${date} · ${c.name}`)),
        h('span', { class: `tx__amount ${income ? 'is-good' : ''}` }, `${income ? '+ ' : '− '}${fmt.format(t.amount)}`),
      );
    }),
  );
}

// --- Boot -----------------------------------------------------------------------

function shiftMonth(delta) {
  const d = new Date(state.ym.y, state.ym.m + delta, 1);
  state.ym = { y: d.getFullYear(), m: d.getMonth() };
  render();
}

function showGreeting(user) {
  const first = (user.fullName || '').split(/\s+/)[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = first ? `${greet}, ${first}` : greet;
}

async function main() {
  // Session, header, navigation and the Desktop/Mobile toolbar (shared with
  // the Transactions page).
  let tx;
  const shell = await initShell({
    kicker: 'finance/dashboard v1.0',
    title: 'Monthly dashboard',
    onReset: async () => {
      // Reload the user's data from the server and jump back to the current month.
      state.ym = { y: new Date().getFullYear(), m: new Date().getMonth() };
      if (tx) await tx.reload();
    },
  });
  if (!shell) return; // redirecting to sign-in
  ({ config } = shell);
  fmt = shell.money.formatter;
  compact = shell.money.compact;
  showGreeting(shell.user);

  // The signed-in user's transactions from the server (GET /v1/transactions).
  tx = await loadTransactionsStore();
  state.cats = tx.categories();
  state.txs = tx.list();
  tx.subscribe(() => {
    state.txs = tx.list();
    render();
  });

  $('prev-month').addEventListener('click', () => shiftMonth(-1));
  $('next-month').addEventListener('click', () => shiftMonth(1));

  render();
  $('main').removeAttribute('aria-busy');
}

main().catch((err) => {
  const slot = $('error');
  slot.hidden = false;
  replaceChildren(slot, alertBox({ title: "We couldn't load your dashboard", body: err.message, action: { label: 'Try again →', onClick: () => location.reload() } }));
  $('greeting').textContent = 'Dashboard';
});
