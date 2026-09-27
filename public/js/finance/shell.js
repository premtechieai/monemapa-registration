/**
 * Shared "app shell" for the signed-in finance pages (dashboard, transactions).
 *
 *  - Session: the pages are served only to signed-in users (the server checks
 *    the httpOnly session cookie). Here we load the user from GET /v1/me —
 *    same cookie, same session — and go to sign-in if it has expired.
 *  - Header: avatar initials, Sign out (revokes the session).
 *  - Navigation: every [data-nav] link gets its URL from config.routes, so
 *    page addresses stay configurable.
 *  - Desktop / Mobile preview toolbar (config.ui.showPreviewToggle).
 *  - Money formatting in config.finance.currency.
 */
import { loadConfig } from '../core/config.js';
import { store } from '../core/store.js';
import { authService } from '../services/authService.js';
import { mountPreviewToggle } from '../components/previewToggle.js';

const $ = (id) => document.getElementById(id);

/** Currency formatters for the configured currency. */
export function createMoney(currency) {
  const full = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  const compact = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  return {
    format: (v) => full.format(v),
    compact: (v) => compact.format(v),
    /** "+ AED 12.00" for income, "− AED 12.00" for expenses. */
    signed: (v, type) => `${type === 'income' ? '+ ' : '− '}${full.format(v)}`,
    /** The currency symbol/code as displayed, e.g. "AED" or "$". */
    symbol: full.formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency,
    formatter: full,
  };
}

/** URL of a configured route, e.g. routeUrl(config, 'transactions', { add: 'income' }). */
export function routeUrl(config, name, params) {
  const path = config.routes[name];
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return path + query;
}

function wireNavigation(config) {
  for (const name of Object.keys(config.routes)) {
    document.querySelectorAll(`[data-nav="${name}"]`).forEach((a) => (a.href = config.routes[name]));
  }
  // Links for sections that aren't built yet ("Coming soon") do nothing.
  document.addEventListener('click', (e) => {
    if (e.target.closest('a[aria-disabled="true"]')) e.preventDefault();
  });
}

function showUser(config, user) {
  const name = user.fullName || '';
  const avatar = $('avatar');
  avatar.textContent = name ? name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : 'ME';
  avatar.title = user.email;
  avatar.setAttribute('aria-label', `Signed in as ${user.email}`);

  const signOut = $('sign-out');
  signOut.disabled = false;
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      await authService.logout();
    } finally {
      store.set('prefillEmail', user.email);
      location.assign(config.routes.login);
    }
  });
}

/**
 * Set up the page shell.
 * @param {{ kicker: string, title: string, onReset: Function }} toolbar  preview toolbar texts + Reset action
 * @returns {Promise<{ config, user, money } | null>} null when redirecting to sign-in
 */
export async function initShell({ kicker, title, onReset }) {
  const config = await loadConfig();
  wireNavigation(config);

  if (config.ui?.showPreviewToggle) {
    mountPreviewToggle({ slot: $('preview-bar'), frame: $('frame'), kicker: `${config.appName} · ${kicker}`, title, onReset });
  } else {
    $('page').classList.add('is-bleed');
  }

  let me;
  try {
    me = await authService.me();
  } catch (err) {
    if (err.status === 401) {
      location.replace(config.routes.login); // session expired or signed out elsewhere
      return null;
    }
    throw err;
  }

  showUser(config, me.user);
  return { config, user: me.user, money: createMoney(config.finance?.currency || 'AED') };
}
