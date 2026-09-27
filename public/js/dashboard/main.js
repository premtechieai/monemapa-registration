/**
 * Dashboard (Overview) page.
 *
 * Session, header, navigation and the Desktop/Mobile toolbar come from the
 * shared finance shell (../finance/shell.js): the page is only served to
 * signed-in users and reuses the login session.
 *
 * Data: GET /v1/dashboard?month=YYYY-MM&today=YYYY-MM-DD — KPIs, the 6-month
 * series, category breakdowns, spending pace and recent transactions are
 * computed on the server (src/modules/dashboard/dashboard.calculator.js).
 *
 * Routing to Transactions: the Income/Spending "+" buttons follow
 * config.dashboard.addTransactionLinks; "View all" keeps the selected month.
 * The month is kept in the URL (?month=YYYY-MM) so it survives reloads.
 */
import { api } from '../core/api.js';
import { h, replaceChildren, svg } from '../core/dom.js';
import { alertBox } from '../components/ui.js';
import { initShell, routeUrl } from '../finance/shell.js';
import { barChart, donut, lineChart, niceMax } from './charts.js';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

/** Local calendar dates (the user's day, not UTC). */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const thisMonth = () => todayKey().slice(0, 7);
const shiftMonthKey = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const monthDate = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
};
const monthName = (month, style = 'long') =>
  monthDate(month).toLocaleDateString(undefined, style === 'long' ? { month: 'long', year: 'numeric' } : { month: style });

let config;
let fmt; // Intl.NumberFormat for config.finance.currency
let compact; // v => "AED 2.4K"
let month = thisMonth();
let request = 0; // ignore responses for months the user already left

const empty = (text) => h('div', { class: 'empty' }, text);

/** Where the "+" buttons go (config.dashboard.addTransactionLinks), with a safe default. */
function addUrl(type) {
  return config.dashboard?.addTransactionLinks?.[type] || routeUrl(config, 'transactions', { add: type });
}

// --- Load -------------------------------------------------------------------------

async function load() {
  const req = ++request;
  const label = monthName(month);
  $('month-label').textContent = label;
  $('next-month').disabled = month >= thisMonth(); // no future months
  $('main').setAttribute('aria-busy', 'true');

  // Keep the month in the URL and in the "View all" links.
  const url = new URL(location.href);
  if (month === thisMonth()) url.searchParams.delete('month');
  else url.searchParams.set('month', month);
  history.replaceState(null, '', url.pathname + url.search);
  document.querySelectorAll('.card__link[data-nav="transactions"]').forEach((a) => (a.href = routeUrl(config, 'transactions', { month })));

  let data;
  try {
    data = await api.get(`/dashboard?month=${month}&today=${todayKey()}`);
  } catch (err) {
    if (err.status === 401) return location.replace(config.routes.login);
    throw err;
  }
  if (req !== request) return;

  $('error').hidden = true;
  $('subtitle').textContent = `Here's your ${label} at a glance.`;
  document.querySelectorAll('[data-month-label]').forEach((el) => (el.textContent = label));
  renderKpis(data);
  renderBars(data);
  renderCategories(data, label);
  renderPace(data);
  renderSources(data, label);
  renderRecent(data);
  $('main').removeAttribute('aria-busy');
}

// --- Render -----------------------------------------------------------------------

function renderKpis({ kpis, prevMonth }) {
  const prevShort = monthName(prevMonth, 'short');
  const prev = kpis.previous;

  /** "▲ 4.2% vs Aug", coloured good/bad depending on direction. */
  const delta = (a, b, upIsGood) => {
    if (!b) return { text: `No data for ${prevShort}`, cls: '' };
    const d = (a - b) / b;
    const up = d >= 0;
    const cls = Math.abs(d) < 0.005 ? '' : up === upIsGood ? 'is-good' : 'is-bad';
    return { text: `${up ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(1)}% vs ${prevShort}`, cls };
  };

  const cards = [
    { label: 'Income', dot: '#40a02b', value: fmt.format(kpis.income), delta: delta(kpis.income, prev?.income, true), add: 'income' },
    { label: 'Spending', dot: '#8839ef', value: fmt.format(kpis.expense), delta: delta(kpis.expense, prev?.expense, false), add: 'expense' },
    {
      label: 'Net savings',
      dot: '#1e66f5',
      value: `${kpis.net < 0 ? '− ' : ''}${fmt.format(Math.abs(kpis.net))}`,
      valueCls: kpis.net < 0 ? 'is-bad' : 'is-good',
      delta: {
        text: prev ? `${kpis.net - prev.net >= 0 ? '▲' : '▼'} ${fmt.format(Math.abs(kpis.net - prev.net))} vs ${prevShort}` : `No data for ${prevShort}`,
        cls: '',
      },
    },
    {
      label: 'Savings rate',
      dot: '#df8e1d',
      value: `${Math.round(kpis.savingsRate * 100)}%`,
      delta: { text: prev ? `${prevShort} was ${Math.round(prev.savingsRate * 100)}%` : 'Share of income kept', cls: '' },
      meter: Math.max(0, Math.min(100, kpis.savingsRate * 100)),
    },
  ];

  replaceChildren(
    $('kpis'),
    cards.map((c) => {
      // "+" on Income and Spending opens the Transactions page's Add panel
      // (targets configurable: config.dashboard.addTransactionLinks).
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

function renderBars({ series }) {
  const points = series.map((p) => ({
    label: monthName(p.month, 'short'),
    full: monthName(p.month),
    inc: p.income,
    exp: p.expense,
    cur: p.current,
  }));
  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.inc, p.exp))));
  $('bars-sub').textContent = `Last ${points.length} months`;
  replaceChildren($('bar-chart'), barChart(points, { max, fmt, compact }));
}

function renderCategories({ spendingByCategory, kpis }, label) {
  if (kpis.expense <= 0) return replaceChildren($('categories'), empty(`No spending recorded for ${label}.`));

  const segments = spendingByCategory.map((r) => ({ id: r.id, v: r.amount, name: r.name, color: r.color, pct: r.pct }));

  // Hover on either the donut or the legend highlights the same category.
  let rows = [];
  const chart = donut(segments, { total: kpis.expense, compact, onHover: (id) => highlight(id) });
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
      h('span', { class: 'legend-row__pct' }, `${sg.pct}%`),
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

function renderPace({ pace, isCurrentMonth, month: m, prevMonth }) {
  const prevShort = monthName(prevMonth, 'short');
  const curPts = pace.current;
  const prevPts = pace.previous;
  const max = niceMax(Math.max(1, ...curPts.map((p) => p[1]), ...prevPts.map((p) => p[1])));

  $('pace-cur').textContent = monthName(m, 'short');
  $('pace-prev').textContent = prevShort;
  replaceChildren($('line-chart'), lineChart(curPts, prevPts, { days: pace.daysInMonth, max, compact }));

  const upTo = pace.currentDays;
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

function renderSources({ incomeBySource, kpis }, label) {
  if (kpis.income <= 0) return replaceChildren($('sources'), empty(`No income recorded for ${label}.`));
  replaceChildren(
    $('sources'),
    h(
      'div',
      { class: 'sources' },
      incomeBySource.map((r) =>
        h(
          'div',
          {},
          h(
            'div',
            { class: 'source__head' },
            h('span', { class: 'legend-row__name' }, r.name),
            h('span', { class: 'num' }, `${fmt.format(r.amount)} `, h('span', { class: 'legend-row__pct' }, `· ${r.pct}%`)),
          ),
          h('div', { class: 'meter source__bar' }, h('div', { class: 'meter__fill', style: { width: `${Math.max(2, r.pct)}%`, background: r.color } })),
        ),
      ),
    ),
  );
}

function renderRecent({ recent }) {
  if (!recent.length) return replaceChildren($('recent'), empty('No transactions this month yet.'));
  replaceChildren(
    $('recent'),
    recent.map((t) => {
      const [yy, mm, dd] = t.date.split('-').map(Number);
      const date = new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const income = t.type === 'income';
      return h(
        'div',
        { class: 'tx' },
        h('span', { class: 'tx__icon', style: { background: `${t.categoryColor}1f` } }, h('span', { class: 'dot', style: { background: t.categoryColor, width: '10px', height: '10px' } })),
        h('div', { class: 'tx__body' }, h('span', { class: 'tx__desc' }, t.description), h('span', { class: 'tx__meta' }, `${date} · ${t.categoryName}`)),
        h('span', { class: `tx__amount ${income ? 'is-good' : ''}` }, `${income ? '+ ' : '− '}${fmt.format(t.amount)}`),
      );
    }),
  );
}

// --- Boot -------------------------------------------------------------------------

function showGreeting(user) {
  const first = (user.fullName || '').split(/\s+/)[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = first ? `${greet}, ${first}` : greet;
}

function showError(err) {
  const slot = $('error');
  slot.hidden = false;
  replaceChildren(slot, alertBox({ title: "We couldn't load your dashboard", body: err.message, action: { label: 'Try again →', onClick: () => load().catch(showError) } }));
}

async function main() {
  const shell = await initShell({
    kicker: 'finance/dashboard v1.0',
    title: 'Monthly dashboard',
    onReset: () => {
      month = thisMonth(); // back to this month, reloaded from the server
      load().catch(showError);
    },
  });
  if (!shell) return; // redirecting to sign-in
  ({ config } = shell);
  fmt = shell.money.formatter;
  compact = shell.money.compact;
  showGreeting(shell.user);

  // ?month=YYYY-MM deep link (past months only).
  const requested = new URLSearchParams(location.search).get('month');
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? '') && requested <= thisMonth()) month = requested;

  $('prev-month').addEventListener('click', () => {
    month = shiftMonthKey(month, -1);
    load().catch(showError);
  });
  $('next-month').addEventListener('click', () => {
    if (month >= thisMonth()) return;
    month = shiftMonthKey(month, 1);
    load().catch(showError);
  });

  await load();
}

main().catch((err) => {
  showError(err);
  $('greeting').textContent = 'Dashboard';
});
