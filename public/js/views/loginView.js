/**
 * Sign-in step 1: enter a registered email to receive a one-time code.
 */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { authService } from '../services/authService.js';
import { alertSlot, submitButton, textField, viewHeader } from '../components/ui.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default {
  flow: 'login',
  step: 0,
  title: 'Sign in',

  render({ navigate }) {
    const banner = alertSlot();
    const emailField = textField({
      id: 'login-email',
      label: 'Email address',
      type: 'email',
      autocomplete: 'email',
      inputmode: 'email',
      placeholder: 'jane@company.com',
      value: store.take('prefillEmail') ?? store.get('login')?.email ?? '',
    });
    const submit = submitButton({ label: 'Send code', loadingLabel: 'Sending code…' });

    emailField.input.addEventListener('input', () => {
      emailField.setError('');
      banner.show(null);
    });

    /** Move to the registration form with this email already filled in. */
    const goRegister = (email) => {
      if (email) store.set('prefillEmail', email);
      navigate('register');
    };

    async function onSubmit(event) {
      event.preventDefault();
      const email = emailField.input.value.trim().toLowerCase();
      banner.show(null);

      if (!EMAIL_RE.test(email)) {
        emailField.setError('Enter a valid email address.');
        emailField.input.focus();
        return;
      }

      submit.setLoading(true);
      try {
        const result = await authService.requestOtp(email);
        store.set('login', {
          email,
          challengeId: result.challengeId,
          expiresAt: result.expiresAt,
          attemptsLeft: result.attemptsLeft,
          otpLength: result.otpLength,
          resendAvailableAt: Date.now() + result.resendAvailableInSec * 1000,
        });
        navigate('otp');
      } catch (err) {
        submit.setLoading(false);
        handleError(err, email);
      }
    }

    function handleError(err, email) {
      switch (err.code) {
        case 'ACCOUNT_NOT_FOUND':
          banner.show({
            title: 'No account for this email',
            body: 'Check the spelling, or create a new account.',
            action: { label: 'Create an account →', onClick: () => goRegister(email) },
          });
          break;
        case 'EMAIL_NOT_VERIFIED': {
          // If this tab started that registration, resume waiting; otherwise
          // registering again with the same email re-sends the link.
          const pending = store.get('registration');
          const resumable = pending?.email === email;
          banner.show({
            title: 'Email not verified yet',
            body: 'Finish verification from the link we sent, then sign in.',
            action: {
              label: resumable ? 'Back to verification →' : 'Resend verification link →',
              onClick: () => (resumable ? navigate('verify') : goRegister(email)),
            },
          });
          break;
        }
        case 'INVALID':
          emailField.setError(err.details.fields?.email ?? err.message);
          break;
        case 'RATE_LIMITED': {
          // A code was sent very recently — reuse it if this tab has it.
          const existing = store.get('login');
          const canReuse = existing?.email === email && existing.challengeId;
          banner.show({
            tone: 'warning',
            title: 'A code was just sent',
            body: err.message,
            action: canReuse ? { label: 'Enter the code →', onClick: () => navigate('otp') } : null,
          });
          break;
        }
        default:
          banner.show({ title: "We couldn't send a code", body: err.message });
      }
    }

    const el = h(
      'form',
      { class: 'view form', novalidate: true, onSubmit },
      viewHeader({
        kicker: 'Sign in',
        title: 'Welcome back',
        lead: "Enter your registered email and we'll send a one-time code.",
      }),
      banner.el,
      emailField.el,
      submit.el,
      h(
        'div',
        { class: 'view__footer' },
        h('span', { class: 'muted' }, 'New here?'),
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => goRegister() }, 'Create an account'),
      ),
    );

    return { el, autofocus: emailField.input };
  },
};
