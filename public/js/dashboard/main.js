/**
 * Dashboard page.
 *
 * Session: the page is only served to signed-in users (the server checks
 * the httpOnly session cookie set at login). Here we load the user from
 * GET /v1/me — same cookie, same session — and send them to sign-in if it
 * has expired. "Sign out" ends the server session.
 *
 * Data: window.MoneMapaTx (transactions-service.js). Totals, trends and
 * charts are computed per selected month, following the dashboard design.
 */
import { loadConfig } from '../core/config.js';
import { h, replaceChildren, svg } from '../core/dom.js';
import { store } from '../core/store.js';
import { authService } from '../services/authService.js';
import { alertBox } from '../components/ui.js';
import { mountPreviewToggle } from '../components/previewToggle.js';
import { barChart, donut, lineChart, niceMax } from './charts.js';

const $ = (id) => document.getElementById(id);

const state = {
  ym: { y: new Date().getFullYear(), m: new Date().getMonth() },
  txs: [],
  cats: [],
};

let config;
let fmt;
let compactFmt;
const compact = (v) => compactFmt.format(v);

// --- Session -----------------------------------------------------------------

async function loadUser() {
  try {
    return await authService.me();
  } catch (err) {
    if (err.status === 401) {
      location.replace(config.routes.login); // session expired or signed out elsewhere
      return null;
    }
    throw err;
  }
}

function showUser({ user }) {
  const name = user.fullName || '';
  const first = name.split(/\s+/)[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = first ? `${greet}, ${first}` : greet;

  const avatar = $('avatar');
  avatar.textContent = name ? name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : 'ME';
  avatar.title = user.email;
  avatar.setAttribute('aria-label', `Signed in as ${user.email}`);

  const signOut = $('sign-out');
  signOut.disabled = false;
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      await authService.logout();
    } finally {
      store.set('prefillEmail', user.email);
      location.assign(config.routes.login);
    }
  });
}

// --- Navigation links (configurable) ----------------------------------------------

function wireNavigation() {
  const tx = config.dashboard.transactionsUrl;
  document.querySelectorAll('[data-nav="dashboard"]').forEach((a) => (a.href = config.routes.dashboard));
  document.querySelectorAll('[data-nav="transactions"]').forEach((a) => {
    if (tx && tx !== '#') {
      a.href = tx;
    } else {
      a.setAttribute('aria-disabled', 'true');
      a.title = 'Coming soon';
    }
  });
  // Links that aren't built yet do nothing when clicked.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[aria-disabled="true"]');
    if (link) e.preventDefault();
  });
}

/** URL of the transactions page with an "add" intent, or null if not configured. */
function addUrl(type) {
  const tx = config.dashboard.transactionsUrl;
  if (!tx || tx === '#') return null;
  return `${tx}${tx.includes('?') ? '&' : '?'}add=${type}`;
}

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
      const href = c.add && addUrl(c.add);
      const label = c.add === 'income' ? 'Add income' : 'Add expense';
      return h(
        'div',
        { class: 'kpi' },
        h(
          'div',
          { class: 'kpi__head' },
          h('span', { class: 'kpi__label' }, h('span', { class: 'dot', style: { background: c.dot } }), c.label),
          href &&
            h(
              'a',
              { class: `kpi__add kpi__add--${c.add}`, href, 'aria-label': label, title: label },
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

/** transactions-service.js is a classic deferred script; wait until it has run. */
function whenTransactionsReady() {
  return new Promise((resolve) => {
    const check = () => (window.MoneMapaTx ? resolve(window.MoneMapaTx) : setTimeout(check, 30));
    check();
  });
}

function shiftMonth(delta) {
  const d = new Date(state.ym.y, state.ym.m + delta, 1);
  state.ym = { y: d.getFullYear(), m: d.getMonth() };
  render();
}

async function main() {
  config = await loadConfig();
  const currency = config.dashboard.currency || 'AED';
  fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  compactFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  wireNavigation();

  // Desktop / Mobile preview toolbar, as on the registration pages.
  // Without it the dashboard fills the whole window.
  if (config.ui?.showPreviewToggle) {
    mountPreviewToggle({
      slot: $('preview-bar'),
      frame: $('frame'),
      kicker: `${config.appName} · finance/dashboard v1.0`,
      title: 'Monthly dashboard',
      onReset: () => {
        // Restore the demo transactions and jump back to the current month.
        window.MoneMapaTx?.reset();
        state.ym = { y: new Date().getFullYear(), m: new Date().getMonth() };
        if (state.cats.length) render();
      },
    });
  } else {
    $('page').classList.add('is-bleed');
  }

  const me = await loadUser();
  if (!me) return;
  showUser(me);

  const tx = await whenTransactionsReady();
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
