/**
 * Dashboard charts as plain SVG (no chart library). Ported from the
 * "finance/dashboard v1.0" design: grouped bar chart, cumulative line chart
 * and donut. Values are data only — all text goes in as text nodes.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const GRID = '#dce0e8';
const MUTED = '#6c6f85';
const TEXT = '#4c4f69';
const INCOME = '#40a02b';
const SPEND = '#8839ef';

/** Create an SVG element: s('rect', { x: 1 }, child, 'text'). */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const svgRoot = (w, h, label, kids) =>
  s('svg', { class: 'chart', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label }, kids);

/** Round a maximum up to a "nice" axis value (1, 2, 5 × 10ⁿ). */
export function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Horizontal grid lines with compact axis labels. */
function gridLines({ fractions, top, innerH, left, right, width, max, compact }) {
  return fractions.flatMap((f) => {
    const y = top + innerH * (1 - f);
    return [
      s('line', { x1: left, x2: width - right, y1: y, y2: y, stroke: GRID, 'stroke-dasharray': f ? '3 4' : null }),
      s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: MUTED }, compact(max * f)),
    ];
  });
}

/**
 * Income vs spending, one group per month.
 * @param {{label, full, inc, exp, cur}[]} series
 */
export function barChart(series, { max, fmt, compact }) {
  const W = 560, H = 230, L = 64, R = 8, T = 12, B = 30; // L fits labels like "AED 10K"
  const ih = H - T - B;
  const gw = (W - L - R) / series.length;
  const bw = Math.min(20, gw * 0.26);
  const kids = gridLines({ fractions: [0, 0.25, 0.5, 0.75, 1], top: T, innerH: ih, left: L, right: R, width: W, max, compact });

  series.forEach((p, i) => {
    const cx = L + gw * i + gw / 2;
    const opacity = p.cur ? 1 : 0.5;
    for (const [value, color, x, label] of [[p.inc, INCOME, cx - bw - 2, 'Income'], [p.exp, SPEND, cx + 2, 'Spending']]) {
      const bh = value ? Math.max(2, (ih * value) / max) : 0;
      kids.push(
        s('rect', { x, y: T + ih - bh, width: bw, height: bh, rx: 3, fill: color, opacity },
          s('title', {}, `${p.full} · ${label} ${fmt.format(value)}`)),
      );
    }
    kids.push(s('text', { x: cx, y: H - 10, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': p.cur ? 700 : 500, fill: p.cur ? TEXT : MUTED }, p.label));
  });

  return svgRoot(W, H, 'Income versus spending for the last six months', kids);
}

/**
 * Cumulative spending by day: this month (solid) vs last month (dashed).
 * @param {[day, total][]} curPts
 * @param {[day, total][]} prevPts
 */
export function lineChart(curPts, prevPts, { days, max, compact }) {
  const W = 560, H = 210, L = 64, R = 12, T = 12, B = 28;
  const ih = H - T - B, iw = W - L - R;
  const X = (d) => L + (iw * (d - 1)) / (days - 1);
  const Y = (v) => T + ih * (1 - v / max);
  const pts = (arr) => arr.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');

  const kids = gridLines({ fractions: [0, 0.5, 1], top: T, innerH: ih, left: L, right: R, width: W, max, compact });
  [1, 8, 15, 22, 29]
    .filter((d) => d <= days)
    .forEach((d) => kids.push(s('text', { x: X(d), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: MUTED }, d)));

  if (prevPts.length) {
    kids.push(s('polyline', { points: pts(prevPts), fill: 'none', stroke: '#9ca0b0', 'stroke-width': 2, 'stroke-dasharray': '5 5', 'stroke-linejoin': 'round' }));
  }
  if (curPts.length) {
    const [lastDay, lastVal] = curPts[curPts.length - 1];
    const area = `M${X(1)},${T + ih} L${pts(curPts).split(' ').join(' L')} L${X(lastDay)},${T + ih} Z`;
    kids.push(s('path', { d: area, fill: SPEND, opacity: 0.1 }));
    kids.push(s('polyline', { points: pts(curPts), fill: 'none', stroke: SPEND, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    kids.push(s('circle', { cx: X(lastDay), cy: Y(lastVal), r: 5, fill: '#fff', stroke: SPEND, 'stroke-width': 2.5 }));
  }

  return svgRoot(W, H, 'Cumulative spending by day compared with last month', kids);
}

/**
 * Spending by category donut. Returns { el, highlight(id|null) } so hover can
 * update it in place (no re-render under the pointer).
 * @param {{id, v, name, color}[]} segments
 */
export function donut(segments, { total, compact, onHover }) {
  const r = 70, C = 2 * Math.PI * r, gap = segments.length > 1 ? 2 : 0;
  const value = s('text', { x: 100, y: 100, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 800, fill: TEXT }, compact(total));
  const label = s('text', { x: 100, y: 120, 'text-anchor': 'middle', 'font-size': 12, fill: MUTED }, 'Total spent');

  let offset = 0;
  const segEls = segments.map((sg) => {
    const len = (C * sg.v) / total;
    const el = s('circle', {
      class: 'donut-seg', cx: 100, cy: 100, r, fill: 'none', stroke: sg.color, 'stroke-width': 26,
      'stroke-dasharray': `${Math.max(len - gap, 0.5)} ${C}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 100 100)',
    }, s('title', {}, sg.name));
    el.addEventListener('mouseenter', () => onHover(sg.id));
    el.addEventListener('mouseleave', () => onHover(null));
    offset += len;
    return [sg, el];
  });

  const el = svgRoot(200, 200, 'Spending by category', [
    s('circle', { cx: 100, cy: 100, r, fill: 'none', stroke: '#e6e9ef', 'stroke-width': 26 }),
    ...segEls.map(([, e]) => e),
    value,
    label,
  ]);

  function highlight(id) {
    const focus = segments.find((x) => x.id === id);
    for (const [sg, e] of segEls) {
      e.classList.toggle('is-dim', Boolean(id) && sg.id !== id);
      e.setAttribute('stroke-width', sg.id === id ? 32 : 26);
    }
    value.textContent = compact(focus ? focus.v : total);
    label.textContent = focus ? focus.name : 'Total spent';
  }

  return { el, highlight };
}
