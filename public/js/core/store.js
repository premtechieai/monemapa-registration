/**
 * Flow state that must survive a page reload (e.g. the user refreshes while
 * waiting for the verification email). Stored in sessionStorage: scoped to
 * this tab and cleared when it closes. Holds no secrets — the registration
 * secret and session tokens live in httpOnly cookies.
 *
 * Shape:
 *   registration  { registrationId, email, name, resendAvailableAt }
 *   login         { email, challengeId, expiresAt, attemptsLeft, resendAvailableAt }
 *   welcomeUser   public user shown on the welcome page
 *   prefillEmail  email to pre-fill on the next form
 */
const KEY = 'monemapa.flow';

function read() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) ?? {};
  } catch {
    return {}; // storage blocked or corrupted — start fresh
  }
}

function write(state) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode); state just won't survive reloads */
  }
}

export const store = {
  get: (key) => read()[key] ?? null,
  set(key, value) {
    const state = read();
    if (value == null) delete state[key];
    else state[key] = value;
    write(state);
  },
  /** Read a value once and remove it (handy for one-shot pre-fills). */
  take(key) {
    const value = store.get(key);
    store.set(key, null);
    return value;
  },
};
