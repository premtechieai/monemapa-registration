/**
 * Sandbox inspector: polls /sandbox/api/state and renders the mock inbox,
 * the database tables and the event log. Development only.
 */
import { h, replaceChildren } from '/js/core/dom.js';

const POLL_MS = 1500;
const TABLES = [
  { key: 'profiles', label: 'profiles' },
  { key: 'registrations', label: 'registrations' },
  { key: 'otpChallenges', label: 'otp_challenges' },
];

let activeTable = 'profiles';
let lastState = null;
let lastJson = '';

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// --- Inbox -------------------------------------------------------------------
function copyButton(text) {
  const btn = h('button', { type: 'button', class: 'btn btn-secondary sbx__tab' }, 'Copy');
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied ✓';
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });
  return btn;
}

function renderMail(mail) {
  const head = [
    h('div', { class: 'sbx__meta' }, h('span', {}, `To ${mail.to}`), h('span', {}, time(mail.at))),
    h('div', { class: 'sbx__subject' }, mail.subject),
  ];

  if (mail.kind === 'otp') {
    return h('div', { class: 'sbx__item' }, head, h('div', { class: 'sbx__row' }, h('span', { class: 'sbx__code' }, mail.code), copyButton(mail.code)));
  }

  const active = mail.linkStatus === 'active';
  const label = { active: 'Open verification link ↗', used: 'Link used ✓', replaced: 'Link replaced by a newer email' }[mail.linkStatus];
  const action = active
    ? h('a', { class: 'btn btn-primary', href: mail.link, target: '_blank', rel: 'noopener' }, label)
    : h('span', { class: 'tag tag--muted' }, label);
  return h('div', { class: 'sbx__item' }, head, h('div', { class: 'sbx__row' }, action));
}

// --- Database ----------------------------------------------------------------
function renderRow(row) {
  const status = row.status && h('span', { class: `tag${row.status === 'EXPIRED' ? ' tag--muted' : ''}` }, row.status);
  const title = row.full_name || row.email;
  return h(
    'div',
    { class: 'sbx__item' },
    h('div', { class: 'sbx__meta' }, h('strong', {}, title), status),
    h('dl', { class: 'sbx__fields' }, Object.entries(row).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '—')])),
  );
}

function renderTabs() {
  replaceChildren(
    document.getElementById('db-tabs'),
    TABLES.map(({ key, label }) => {
      const count = lastState?.[key]?.length ?? 0;
      return h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'btn btn-secondary sbx__tab',
          'aria-selected': String(key === activeTable),
          onClick: () => {
            activeTable = key;
            render(lastState);
          },
        },
        `${label} (${count})`,
      );
    }),
  );
}

// --- Render ------------------------------------------------------------------
function empty(text) {
  return h('div', { class: 'sbx__empty' }, text);
}

function render(state) {
  document.getElementById('inbox-count').textContent = `${state.inbox.length} message${state.inbox.length === 1 ? '' : 's'}`;
  replaceChildren(
    document.getElementById('inbox'),
    state.inbox.length ? state.inbox.map(renderMail) : empty('No messages yet. Register in the app to receive a verification email.'),
  );

  renderTabs();
  const rows = state[activeTable];
  replaceChildren(document.getElementById('db'), rows.length ? [...rows].reverse().map(renderRow) : empty('No rows.'));

  replaceChildren(
    document.getElementById('log'),
    state.events.length
      ? state.events.map((e) =>
          h(
            'div',
            { class: `sbx__log-item${e.isError ? ' is-error' : ''}` },
            h('span', { class: 'sbx__log-time' }, time(e.at)),
            h('div', {}, h('div', { class: 'sbx__log-type' }, e.type), h('div', { class: 'sbx__log-detail' }, e.detail)),
          ),
        )
      : empty('No activity yet.'),
  );
}

async function refresh() {
  try {
    const res = await fetch('/sandbox/api/state', { cache: 'no-store' });
    const text = await res.text();
    if (text !== lastJson) {
      // Only re-render on change, so buttons don't flicker mid-click.
      lastJson = text;
      lastState = JSON.parse(text);
      render(lastState);
    }
  } catch {
    /* server restarting (node --watch) — try again next tick */
  }
}

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('Delete all sandbox users, emails and events, then re-seed?')) return;
  await fetch('/sandbox/api/reset', { method: 'POST' });
  lastJson = '';
  refresh();
});

refresh();
setInterval(refresh, POLL_MS);
