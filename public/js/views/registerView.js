/**
 * Step 1 of registration: name + email + terms.
 * On success the server emails a verification link and we move to the
 * "Check your inbox" view.
 */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { registrationService } from '../services/registrationService.js';
import { alertSlot, submitButton, textField, viewHeader } from '../components/ui.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Mirror of the server rules, so most mistakes are caught instantly. */
function validate({ name, email, termsAccepted }) {
  const errors = {};
  if (name.trim().length < 2) errors.name = 'Enter your full name.';
  if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address, like jane@company.com.';
  if (!termsAccepted) errors.termsAccepted = 'Please accept the terms to continue.';
  return errors;
}

export default {
  flow: 'register',
  step: 0,
  title: 'Create your account',

  render({ config, navigate }) {
    const banner = alertSlot();
    const nameField = textField({ id: 'reg-name', label: 'Full name', autocomplete: 'name', placeholder: 'Jane Appleseed', maxlength: '120' });
    const emailField = textField({
      id: 'reg-email',
      label: 'Email address',
      type: 'email',
      autocomplete: 'email',
      inputmode: 'email',
      placeholder: 'jane@company.com',
      value: store.take('prefillEmail') ?? '',
    });
    const terms = h('input', { type: 'checkbox', id: 'reg-terms', 'aria-describedby': 'reg-terms-error' });
    const termsError = h('div', { class: 'field__error', id: 'reg-terms-error' });
    const submit = submitButton({ label: 'Continue', loadingLabel: 'Checking email…' });

    const fieldErrorSetters = {
      name: nameField.setError,
      email: emailField.setError,
      termsAccepted: (msg) => (termsError.textContent = msg || ''),
    };

    function showErrors(errors) {
      Object.entries(fieldErrorSetters).forEach(([key, set]) => set(errors[key]));
      const first = { name: nameField.input, email: emailField.input, termsAccepted: terms }[Object.keys(errors)[0]];
      first?.focus();
    }

    // Clear a field's error as soon as the user edits it.
    nameField.input.addEventListener('input', () => nameField.setError(''));
    emailField.input.addEventListener('input', () => {
      emailField.setError('');
      banner.show(null);
    });
    terms.addEventListener('change', () => (termsError.textContent = ''));

    async function onSubmit(event) {
      event.preventDefault();
      const values = { name: nameField.input.value.trim(), email: emailField.input.value.trim(), termsAccepted: terms.checked };

      const errors = validate(values);
      showErrors(errors);
      banner.show(null);
      if (Object.keys(errors).length) return;

      submit.setLoading(true);
      try {
        const result = await registrationService.register(values);
        store.set('registration', {
          registrationId: result.registrationId,
          email: result.email,
          name: values.name,
          resendAvailableAt: Date.now() + result.resendAvailableInSec * 1000,
        });
        navigate('verify');
      } catch (err) {
        submit.setLoading(false);
        handleError(err, values.email);
      }
    }

    function handleError(err, email) {
      switch (err.code) {
        case 'EMAIL_EXISTS':
          emailField.input.setAttribute('aria-invalid', 'true'); // red border; the banner explains why
          banner.show({
            title: 'This email is already registered',
            body: `${email} has an active account. Sign in with a one-time code instead.`,
            action: {
              label: 'Sign in instead →',
              onClick: () => {
                store.set('prefillEmail', email);
                navigate('login');
              },
            },
          });
          break;
        case 'INVALID':
          showErrors(err.details.fields ?? {});
          break;
        case 'RATE_LIMITED':
          banner.show({ tone: 'warning', title: 'Please wait a moment', body: err.message });
          break;
        default:
          banner.show({ title: "We couldn't create your account", body: err.message });
      }
    }

    const el = h(
      'form',
      { class: 'view form', novalidate: true, onSubmit },
      viewHeader({
        kicker: 'Step 1 of 3',
        title: 'Create your account',
        lead: "Tell us who you are. We'll send a link to confirm your email.",
      }),
      banner.el,
      h(
        'div',
        { class: 'fields' },
        nameField.el,
        emailField.el,
        h(
          'div',
          { class: 'field' },
          h(
            'label',
            { class: 'checkbox', for: 'reg-terms' },
            terms,
            h(
              'span',
              {},
              'I agree to the ',
              h('a', { href: config.links.termsUrl, target: '_blank', rel: 'noopener' }, 'Terms of Service'),
              ' and ',
              h('a', { href: config.links.privacyUrl, target: '_blank', rel: 'noopener' }, 'Privacy Policy'),
              '.',
            ),
          ),
          termsError,
        ),
      ),
      submit.el,
      h(
        'div',
        { class: 'view__footer' },
        h('span', { class: 'muted' }, 'Already have an account?'),
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => navigate('login') }, 'Sign in'),
      ),
    );

    return { el, autofocus: nameField.input };
  },
};
