/**
 * Dashboard hand-off. Confirms the session with the server (GET /v1/me) and
 * shows who is signed in. In a full product, the host application mounts its
 * real dashboard here.
 */
import { h, replaceChildren } from '../core/dom.js';
import { store } from '../core/store.js';
import { authService } from '../services/authService.js';
import { alertSlot, formatDate, keyValueList } from '../components/ui.js';

const METHOD_LABELS = {
  EMAIL_VERIFICATION: 'Email verification',
  ONE_TIME_CODE: 'One-time code',
};

export default {
  flow: 'login',
  step: 2,
  complete: true,
  title: 'Dashboard',

  render({ navigate }) {
    const banner = alertSlot();
    const kicker = h('div', { class: 'kicker' }, 'Signed in');
    const title = h('h1', { class: 'title', tabindex: '-1' }, 'Dashboard');
    const details = h(
      'div',
      { class: 'kv', 'aria-busy': 'true' },
      [1, 2, 3, 4].map(() => h('div', { class: 'kv__row' }, h('div', { class: 'skeleton', style: { width: '100%' } }))),
    );

    const signOut = h('button', { type: 'button', class: 'btn btn-secondary', disabled: true }, 'Sign out');

    signOut.addEventListener('click', async () => {
      signOut.disabled = true;
      const email = signOut.dataset.email;
      try {
        await authService.logout();
      } finally {
        if (email) store.set('prefillEmail', email);
        navigate('login');
      }
    });

    // Load the session; bounce to sign-in if there isn't one.
    authService
      .me()
      .then(({ user, session }) => {
        const firstName = user.fullName.split(/\s+/)[0];
        kicker.textContent = session.method ? `Signed in · ${METHOD_LABELS[session.method] ?? session.method}` : 'Signed in';
        title.textContent = `Hello, ${firstName}`;
        replaceChildren(
          details,
          keyValueList([
            { label: 'Name', value: user.fullName },
            { label: 'Email', value: user.email },
            { label: 'User ID', value: user.id, mono: true },
            { label: 'Registered', value: formatDate(user.registeredAt) },
            { label: 'Session started', value: formatDate(session.startedAt) },
          ]),
        );
        details.classList.remove('kv');
        details.removeAttribute('aria-busy');
        signOut.dataset.email = user.email;
        signOut.disabled = false;
      })
      .catch((err) => {
        if (err.status === 401) return navigate('login', { replace: true });
        banner.show({ title: "We couldn't load your account", body: err.message, action: { label: 'Try again →', onClick: () => navigate('dashboard', { replace: true }) } });
      });

    const el = h(
      'div',
      { class: 'view' },
      h(
        'div',
        { class: 'view__head' },
        kicker,
        title,
        h('p', { class: 'lead' }, 'You’re signed in. This is where the application’s dashboard is mounted.'),
      ),
      banner.el,
      details,
      h('div', { class: 'btn-row' }, signOut),
    );

    return { el };
  },
};
