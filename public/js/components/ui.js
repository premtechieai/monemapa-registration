/**
 * Small presentational building blocks shared by the views.
 */
import { h, replaceChildren } from '../core/dom.js';
import { icon } from './icons.js';

/** Kicker + title + lead paragraph at the top of every view. */
export function viewHeader({ kicker, title, lead, xl = false }) {
  return h(
    'div',
    { class: 'view__head' },
    h('div', { class: 'kicker' }, kicker),
    // tabindex=-1 lets the router move focus here on navigation (screen readers).
    h('h1', { class: `title${xl ? ' title--xl' : ''}`, tabindex: '-1' }, title),
    lead && h('p', { class: 'lead' }, lead),
  );
}

/**
 * Error / warning banner.
 * @param {{ title: string, body?: string|Node, action?: { label: string, onClick: Function }, tone?: 'danger'|'warning' }} opts
 */
export function alertBox({ title, body, action, tone = 'danger' }) {
  return h(
    'div',
    { class: `alert${tone === 'warning' ? ' alert--warning' : ''}`, role: 'alert' },
    icon('alert', { size: 18, className: 'alert__icon' }),
    h(
      'div',
      { class: 'alert__body' },
      h('div', { class: 'alert__title' }, title),
      body && h('div', {}, body),
      action && h('button', { type: 'button', class: 'btn btn-ghost', onClick: action.onClick }, action.label),
    ),
  );
}

/** A slot that shows at most one alert; `show(null)` clears it. */
export function alertSlot() {
  const el = h('div', { class: 'alert-slot' });
  el.hidden = true;
  return {
    el,
    show(opts) {
      el.hidden = !opts;
      replaceChildren(el, opts ? alertBox(opts) : null);
    },
  };
}

/**
 * Labelled text input with an inline error message.
 * Returns { el, input, setError(msg) }.
 */
export function textField({ id, label, ...inputProps }) {
  const errorId = `${id}-error`;
  const input = h('input', { id, class: 'input', 'aria-describedby': errorId, ...inputProps });
  const error = h('div', { class: 'field__error', id: errorId });
  return {
    el: h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, label), input, error),
    input,
    setError(message) {
      error.textContent = message || '';
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    },
  };
}

/**
 * Primary button with a built-in loading state.
 * Returns { el, setLoading(isLoading) }.
 */
export function submitButton({ label, loadingLabel, withArrow = true, type = 'submit', className = 'btn btn-primary btn-block' }) {
  const text = h('span', {}, label);
  const trailing = h('span', { class: 'btn__trail', style: { display: 'inline-flex' } });
  const el = h('button', { type, class: className }, text, trailing);

  function setLoading(loading) {
    el.disabled = loading;
    el.setAttribute('aria-busy', String(loading));
    text.textContent = loading ? loadingLabel : label;
    replaceChildren(trailing, loading ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : withArrow && icon('arrowRight'));
  }
  setLoading(false);
  return { el, setLoading };
}

/**
 * Button that is disabled for a cooldown period, showing the countdown
 * ("Resend email in 42s"). Returns { el, startCooldown(sec), destroy() }.
 */
export function cooldownButton({ label, countdownLabel, onClick, className = 'btn btn-secondary' }) {
  const el = h('button', { type: 'button', class: className, onClick });
  let timer = null;
  let until = 0;

  function render() {
    const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    el.disabled = left > 0;
    el.textContent = left > 0 ? countdownLabel(left) : label;
    if (left === 0) clearInterval(timer);
  }

  return {
    el,
    /** @param {number} seconds cooldown length; 0 enables the button now */
    startCooldown(seconds) {
      clearInterval(timer);
      until = Date.now() + seconds * 1000;
      render();
      if (seconds > 0) timer = setInterval(render, 1000);
    },
    /** Temporarily disable (e.g. during a request) without touching the countdown. */
    setBusy(busy) {
      if (busy) el.disabled = true;
      else render();
    },
    destroy: () => clearInterval(timer),
  };
}

/** Definition list of label/value rows (welcome + dashboard). */
export function keyValueList(rows) {
  return h(
    'dl',
    { class: 'kv' },
    rows.map(({ label, value, mono }) =>
      h('div', { class: 'kv__row' }, h('dt', {}, label), h('dd', { class: mono ? 'mono' : null }, value ?? '—')),
    ),
  );
}

/** Format an ISO date for display, e.g. "Sep 25, 7:42 PM". */
export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
