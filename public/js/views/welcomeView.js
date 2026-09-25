/**
 * Step 3 of registration: celebrate the new account and hand off to the
 * dashboard. The server already started a session when verification
 * completed, so "Go to dashboard" needs no extra sign-in.
 */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { formatDate, keyValueList, submitButton, viewHeader } from '../components/ui.js';
import { confetti, successMark } from '../components/celebration.js';

export default {
  flow: 'register',
  step: 2,
  complete: true,
  title: 'Welcome aboard',

  render({ navigate }) {
    const user = store.get('welcomeUser');
    if (!user) return { redirect: 'login' };

    const firstName = user.fullName.split(/\s+/)[0];
    const cta = submitButton({ label: 'Go to dashboard', loadingLabel: 'Opening…', type: 'button' });
    cta.el.addEventListener('click', () => {
      store.set('welcomeUser', null);
      navigate('dashboard');
    });

    const el = h(
      'div',
      { class: 'view' },
      successMark(),
      viewHeader({
        kicker: 'Email verified',
        title: `Welcome aboard, ${firstName}.`,
        lead: 'Your account is active. Next time, sign in with a one-time code sent to your email.',
        xl: true,
      }),
      keyValueList([
        { label: 'Account ID', value: user.id, mono: true },
        { label: 'Email', value: user.email },
        { label: 'Registered', value: formatDate(user.registeredAt) },
      ]),
      cta.el,
    );

    // Confetti covers the whole content column, not just the form width.
    const burst = confetti();
    document.getElementById('main').append(burst);

    return { el, autofocus: cta.el, destroy: () => burst.remove() };
  },
};
