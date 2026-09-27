/**
 * Pure functions that turn raw transactions into the dashboard payload
 * (merged from the monemapa-main project). No I/O, so it's easy to unit-test
 * (see test/dashboard.calculator.test.js).
 */
import { addMonths, daysInMonth } from '../../lib/dates.js';

const sum = (list, type) => list.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
const round2 = (n) => Math.round(n * 100) / 100;
const FALLBACK = { name: 'Other', color: '#8c8fa1' };

/** Totals + savings rate for a list of transactions. */
export function totals(list) {
  const income = sum(list, 'income');
  const expense = sum(list, 'expense');
  const net = income - expense;
  return { income: round2(income), expense: round2(expense), net: round2(net), savingsRate: income > 0 ? net / income : 0 };
}

/** Group by category, sorted, with % share. Rows beyond `maxSegments` are merged into "Everything else". */
export function groupByCategory(list, type, catMap, maxSegments = Infinity) {
  const byCat = {};
  list.filter((t) => t.type === type).forEach((t) => (byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount));
  const total = Object.values(byCat).reduce((a, b) => a + b, 0);
  let rows = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([id, amount]) => {
      const c = catMap[id] || catMap.other || FALLBACK;
      return { id, name: c.name, color: c.color, amount: round2(amount) };
    });
  if (rows.length > maxSegments + 1) {
    const rest = rows.slice(maxSegments).reduce((a, r) => a + r.amount, 0);
    rows = rows.slice(0, maxSegments).concat({ id: '_rest', name: 'Everything else', color: '#9ca0b0', amount: round2(rest) });
  }
  return rows.map((r) => ({ ...r, pct: total ? Math.round((r.amount / total) * 100) : 0 }));
}

/** Cumulative daily spending: [[day, cumulativeAmount], ...] for days 1..days. */
export function cumulativeSpend(list, days) {
  const perDay = Array(days + 1).fill(0);
  list.filter((t) => t.type === 'expense').forEach((t) => (perDay[Number(t.date.slice(8, 10))] += t.amount));
  let running = 0;
  return Array.from({ length: days }, (_, i) => [i + 1, round2((running += perDay[i + 1]))]);
}

/**
 * Build the dashboard payload.
 * @param {object}   args
 * @param {object[]} args.transactions  from the oldest chart month to the end of `month`
 * @param {object[]} args.categories
 * @param {string}   args.month         "YYYY-MM" being viewed
 * @param {string}   args.today         "YYYY-MM-DD" (the browser's local date)
 * @param {{ chartMonths, recentTransactions, maxDonutSegments }} args.options
 */
export function buildDashboard({ transactions, categories, month, today, options }) {
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const inMonth = (m) => transactions.filter((t) => t.date.startsWith(m));
  const prevMonth = addMonths(month, -1);
  const cur = inMonth(month);
  const prev = inMonth(prevMonth);

  const series = Array.from({ length: options.chartMonths }, (_, i) => {
    const m = addMonths(month, i - (options.chartMonths - 1));
    return { month: m, ...totals(inMonth(m)), current: m === month };
  });

  const isCurrentMonth = today.startsWith(month);
  const curDays = daysInMonth(month);
  const spendDays = isCurrentMonth ? Number(today.slice(8, 10)) : curDays;

  return {
    month,
    prevMonth,
    isCurrentMonth,
    kpis: { ...totals(cur), previous: prev.length ? totals(prev) : null },
    series,
    spendingByCategory: groupByCategory(cur, 'expense', catMap, options.maxDonutSegments),
    incomeBySource: groupByCategory(cur, 'income', catMap),
    pace: {
      currentDays: spendDays,
      current: cumulativeSpend(cur, curDays).slice(0, spendDays),
      previous: cumulativeSpend(prev, daysInMonth(prevMonth)),
      daysInMonth: Math.max(curDays, daysInMonth(prevMonth)),
    },
    recent: cur
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, options.recentTransactions)
      .map((t) => {
        const c = catMap[t.categoryId] || catMap.other || FALLBACK;
        return { ...t, categoryName: c.name, categoryColor: c.color };
      }),
  };
}
