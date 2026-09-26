/**
 * Sign-in step 2: enter the one-time code from the email.
 * Shows the expiry countdown and remaining attempts; submits automatically
 * once every digit is entered.
 */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { authService } from '../services/authService.js';
import { cooldownButton, submitButton, viewHeader } from '../components/ui.js';
import { otpInput } from '../components/otpInput.js';

const pluralAttempts = (n) => `${n} ${n === 1 ? 'attempt' : 'attempts'} left`;

export default {
  flow: 'login',
  step: 1,
  title: 'Enter your code',

  render({ config, navigate }) {
    let login = store.get('login');
    if (!login?.challengeId) return { redirect: 'login' };

    const length = login.otpLength ?? config.otp.length;
    let busy = false;
    let locked = false;

    const errorLine = h('div', { class: 'field__error', role: 'alert' });
    const expiryLabel = h('span', {});
    const attemptsLabel = h('span', {}, pluralAttempts(login.attemptsLeft));
    const submit = submitButton({ label: 'Verify and sign in', loadingLabel: 'Verifying…', withArrow: false });
    const code = otpInput({
      length,
      onComplete: () => verify(),
      onChange: () => (errorLine.textContent = ''),
    });

    function showError(message) {
      errorLine.textContent = message;
      code.setError(true);
    }

    /** Stop accepting input until the user requests a new code. */
    function lock(message) {
      locked = true;
      showError(message);
      code.setDisabled(true);
      submit.el.disabled = true;
    }

    // --- Expiry countdown ---------------------------------------------------
    const expiresAt = new Date(login.expiresAt).getTime();
    function renderExpiry() {
      const left = Math.max(0, expiresAt - Date.now());
      const mm = Math.floor(left / 60000);
      const ss = String(Math.floor(left / 1000) % 60).padStart(2, '0');
      expiryLabel.textContent = left > 0 ? `Code expires in ${mm}:${ss}` : 'Code expired';
      if (left === 0 && !locked) lock('This code has expired. Request a new one.');
    }
    renderExpiry();
    const expiryTimer = setInterval(renderExpiry, 1000);

    // --- Verify -------------------------------------------------------------
    async function verify(event) {
      event?.preventDefault();
      if (busy || locked) return;

      const value = code.getCode();
      if (value.length < length) {
        showError(`Enter all ${length} digits.`);
        code.focus();
        return;
      }

      busy = true;
      submit.setLoading(true);
      code.setDisabled(true);
      try {
        await authService.verifyOtp(login.challengeId, value);
        store.set('login', null);
        // Signed in: go to the dashboard page (configurable: routes.dashboard).
        // replace() so Back doesn't return to the used code screen; the new
        // session cookie from this response is sent with the page request.
        location.replace(config.routes.dashboard);
        return;
      } catch (err) {
        busy = false;
        submit.setLoading(false);
        code.setDisabled(false);
        handleError(err);
      }
    }

    function handleError(err) {
      switch (err.code) {
        case 'OTP_INVALID': {
          const left = err.details.attemptsLeft;
          login = { ...login, attemptsLeft: left };
          store.set('login', login);
          attemptsLabel.textContent = pluralAttempts(left);
          showError(`Incorrect code. ${pluralAttempts(left)}.`);
          code.clear();
          break;
        }
        case 'OTP_LOCKED':
          attemptsLabel.textContent = pluralAttempts(0);
          lock('Too many attempts. Request a new code.');
          break;
        case 'OTP_EXPIRED':
        case 'NOT_FOUND':
          lock('This code has expired. Request a new one.');
          break;
        case 'INVALID':
          showError(err.details.fields?.code ?? err.message);
          break;
        default:
          showError(err.message);
      }
    }

    // --- Resend -------------------------------------------------------------
    const resend = cooldownButton({
      label: 'Resend code',
      countdownLabel: (s) => `Resend code in ${s}s`,
      onClick: async () => {
        resend.setBusy(true);
        try {
          const result = await authService.requestOtp(login.email);
          store.set('login', {
            ...login,
            challengeId: result.challengeId,
            expiresAt: result.expiresAt,
            attemptsLeft: result.attemptsLeft,
            resendAvailableAt: Date.now() + result.resendAvailableInSec * 1000,
          });
          navigate('otp', { replace: true }); // re-render with the fresh challenge
        } catch (err) {
          if (err.code === 'RATE_LIMITED') resend.startCooldown(err.details.retryAfterSec ?? 30);
          else resend.setBusy(false);
          errorLine.textContent = err.message;
        }
      },
    });
    resend.startCooldown(Math.max(0, Math.ceil((login.resendAvailableAt - Date.now()) / 1000)));

    const el = h(
      'form',
      { class: 'view form', novalidate: true, onSubmit: verify },
      viewHeader({
        kicker: 'Step 2 of 3',
        title: 'Enter your code',
        lead: [`We sent a ${length}-digit code to `, h('strong', {}, login.email), '.'],
      }),
      h('div', { class: 'field' }, code.el, errorLine, h('div', { class: 'otp-meta' }, expiryLabel, attemptsLabel)),
      submit.el,
      h(
        'div',
        { class: 'view__footer' },
        resend.el,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost',
            onClick: () => {
              store.set('prefillEmail', login.email);
              store.set('login', null);
              navigate('login');
            },
          },
          'Change email',
        ),
      ),
    );

    return {
      el,
      autofocus: { focus: () => code.focus() },
      destroy() {
        clearInterval(expiryTimer);
        resend.destroy();
      },
    };
  },
};
