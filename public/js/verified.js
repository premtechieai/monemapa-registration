/**
 * Landing page for the verification link in the email.
 *
 * Supabase confirms the email *before* redirecting here and appends either
 * tokens or an error to the URL fragment (#...). We only read the error, then
 * wipe the fragment so tokens don't linger in the address bar or history.
 * The original tab — which is polling — picks up the verification itself.
 */
import { loadConfig } from './core/config.js';
import { h, replaceChildren } from './core/dom.js';
import { viewHeader } from './components/ui.js';
import { successMark } from './components/celebration.js';
import { icon } from './components/icons.js';

const outlet = document.getElementById('view');

function readFragment() {
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname); // strip tokens from the URL
  return { error: params.get('error'), errorCode: params.get('error_code'), description: params.get('error_description') };
}

async function main() {
  const { error, errorCode, description } = readFragment();
  const config = await loadConfig();
  const link = (route, label, primary) =>
    h('a', { class: `btn ${primary ? 'btn-primary btn-block' : 'btn-secondary'}`, href: route }, label);

  if (error) {
    const expired = errorCode === 'otp_expired';
    replaceChildren(
      outlet,
      h(
        'div',
        { class: 'view' },
        h('div', { class: 'icon-tile' }, icon('clock', { size: 26 })),
        viewHeader({
          kicker: 'Verification failed',
          title: expired ? 'This link has expired' : 'We couldn’t verify this link',
          lead: expired
            ? 'Verification links can only be used once and expire after a while. Start again to get a fresh link.'
            : description || 'The link may be incomplete. Try opening it again, or start over.',
        }),
        link(config.routes.register, 'Start again', true),
      ),
    );
    return;
  }

  replaceChildren(
    outlet,
    h(
      'div',
      { class: 'view' },
      successMark(),
      viewHeader({
        kicker: 'Email verified',
        title: 'You’re all set',
        lead: 'Your email is confirmed. Go back to the tab where you signed up — it continues automatically. Opened this on another device? You can sign in here with a one-time code.',
      }),
      h('div', { class: 'btn-row' }, link(config.routes.login, 'Sign in on this device')),
    ),
  );
}

main().catch((err) => replaceChildren(outlet, h('p', {}, err.message)));
