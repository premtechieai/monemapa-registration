/**
 * Month helpers. Months are "YYYY-MM" strings; dates are "YYYY-MM-DD" strings
 * (calendar dates, no timezone maths). From the monemapa-main project.
 */
const pad = (n) => String(n).padStart(2, '0');

/** Shift a "YYYY-MM" month by N months (negative = past). */
export function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const firstDay = (month) => `${month}-01`;
export const lastDay = (month) => `${month}-${pad(daysInMonth(month))}`;
export const todayString = () => new Date().toISOString().slice(0, 10);
