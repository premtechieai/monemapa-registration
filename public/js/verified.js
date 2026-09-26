/**
 * Landing page for the activation link in the verification email.
 *
 * The link looks like /verified#token=... — the token is in the URL fragment,
 * which browsers never send to the server, so it stays out of logs. This page
 * reads it, removes it from the address bar, and POSTs it to the API. Doing
 * the verification with a POST (not on page load via GET) also stops email
 * link scanners from activating accounts by merely fetching the URL.
 *
 * The original tab — which is polling — then continues automatically.
 */
import { loadConfig } from './core/config.js';
import { api } from './core/api.js';
import { h, replaceChildren } from './core/dom.js';
import { viewHeader } from './components/ui.js';
import { successMark } from './components/celebration.js';
import { icon } from './components/icons.js';

const outlet = document.getElementById('view');

/** Read the token from the fragment, then strip it from the URL and history. */
function takeToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', location.pathname);
  return token;
}

const button = (href, label, primary) =>
  h('a', { class: `btn ${primary ? 'btn-primary btn-block' : 'btn-secondary'}`, href }, label);

function showSpinner() {
  replaceChildren(
    outlet,
    h(
      'div',
      { class: 'view' },
      viewHeader({ kicker: 'Account activation', title: 'Verifying your email…' }),
      h('div', { class: 'btn-row' }, h('span', { class: 'spinner', 'aria-hidden': 'true' })),
    ),
  );
}

function showSuccess(config, email) {
  replaceChildren(
    outlet,
    h(
      'div',
      { class: 'view' },
      successMark(),
      viewHeader({
        kicker: 'Email verified',
        title: 'Your account is active',
        lead: [
          h('strong', {}, email),
          ' is confirmed. Go back to the tab where you signed up — it continues automatically. ' +
            'Opened this on another device? Sign in here with a one-time code.',
        ],
      }),
      h('div', { class: 'btn-row' }, button(config.routes.login, 'Sign in on this device')),
    ),
  );
}

function showFailure(config, { title, lead }) {
  replaceChildren(
    outlet,
    h(
      'div',
      { class: 'view' },
      h('div', { class: 'icon-tile' }, icon('clock', { size: 26 })),
      viewHeader({ kicker: 'Verification failed', title, lead }),
      h('div', { class: 'btn-row' }, button(config.routes.register, 'Register again', true), button(config.routes.login, 'Sign in')),
    ),
  );
}

async function main() {
  const token = takeToken();
  const config = await loadConfig();

  if (!token) {
    return showFailure(config, {
      title: 'This link is incomplete',
      lead: 'Open the link from your email again, or copy the whole address into your browser.',
    });
  }

  showSpinner();
  try {
    const result = await api.post('/verifications', { token });
    showSuccess(config, result.email);
  } catch (err) {
    const failures = {
      LINK_EXPIRED: {
        title: 'This link has expired',
        lead: `Activation links are valid for ${config.registration.linkTtlHours} hours. Register again to get a new one.`,
      },
      LINK_INVALID: {
        title: 'This link has already been used',
        lead: 'If you already activated your account, sign in with a one-time code. ' +
          'If you requested another email since, use the link in the newest one.',
      },
    };
    showFailure(config, failures[err.code] ?? { title: 'We couldn’t verify this link', lead: err.message });
  }
}

main().catch((err) => replaceChildren(outlet, h('p', {}, err.message)));
