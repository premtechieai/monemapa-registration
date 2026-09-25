/**
 * Step 2 of registration: "Check your inbox".
 * Polls the server until the user clicks the emailed link (on any device),
 * then continues to the welcome screen automatically.
 */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { registrationService } from '../services/registrationService.js';
import { createVerificationPoller } from '../services/verificationPoller.js';
import { alertSlot, cooldownButton, viewHeader } from '../components/ui.js';
import { icon } from '../components/icons.js';

export default {
  flow: 'register',
  step: 1,
  title: 'Check your inbox',

  render({ config, navigate }) {
    const registration = store.get('registration');
    if (!registration) return { redirect: 'register' };

    const { pollIntervalSec, pollTimeoutMin, linkTtlHours } = config.registration;
    const banner = alertSlot();

    // --- Live status card ---------------------------------------------------
    const pulse = h('span', { class: 'pulse', 'aria-hidden': 'true' });
    const statusText = h('span', {}, 'Waiting for verification');
    const checksValue = h('div', { class: 'stat__value' }, '0');
    const nextValue = h('div', { class: 'stat__value' }, `${pollIntervalSec}s`);
    const statusCard = h(
      'div',
      { class: 'status-card' },
      h('div', { class: 'status-card__head' }, pulse, statusText),
      h(
        'div',
        { class: 'status-card__stats' },
        h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Status checks'), checksValue),
        h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Next check'), nextValue),
      ),
    );

    function setPaused(text) {
      pulse.classList.add('is-paused');
      statusText.textContent = text;
      nextValue.textContent = '—';
    }

    // --- Poller ---------------------------------------------------------------
    const poller = createVerificationPoller({
      registrationId: registration.registrationId,
      intervalSec: pollIntervalSec,
      timeoutMin: pollTimeoutMin,

      onTick({ checks, nextCheckInSec, inFlight }) {
        pulse.classList.remove('is-paused');
        statusText.textContent = 'Waiting for verification';
        checksValue.textContent = String(checks);
        nextValue.textContent = inFlight ? '…' : `${nextCheckInSec}s`;
      },

      onResult(result) {
        if (result.status === 'VERIFIED') {
          store.set('registration', null);
          store.set('welcomeUser', result.user);
          navigate('welcome', { replace: true });
          return;
        }
        // EXPIRED
        setPaused('Link expired');
        banner.show({
          title: 'Your verification link has expired',
          body: 'Start again and we’ll send you a new one.',
          action: { label: 'Start again →', onClick: startOver },
        });
      },

      onError(err, { fatal }) {
        if (fatal) {
          // 404: this browser no longer owns the registration (e.g. the same
          // email was submitted again in another tab or device).
          setPaused('Stopped');
          banner.show({
            title: 'This sign-up continued somewhere else',
            body: 'If you already verified your email, sign in with a one-time code.',
            action: { label: 'Go to sign in →', onClick: () => goToLogin() },
          });
        } else {
          banner.show({ tone: 'warning', title: 'Connection issue', body: 'Retrying automatically…' });
          setTimeout(() => banner.show(null), 4000);
        }
      },

      onTimeout() {
        setPaused('Paused');
        banner.show({
          tone: 'warning',
          title: 'Still waiting?',
          body: 'We paused automatic checks. Resume once you’ve clicked the link.',
          action: {
            label: 'Check again →',
            onClick: () => {
              banner.show(null);
              poller.start();
            },
          },
        });
      },
    });

    // --- Actions ------------------------------------------------------------
    const resend = cooldownButton({
      label: 'Resend email',
      countdownLabel: (s) => `Resend email in ${s}s`,
      onClick: async () => {
        resend.setBusy(true);
        try {
          const result = await registrationService.resend(registration.registrationId);
          store.set('registration', { ...registration, resendAvailableAt: Date.now() + result.resendAvailableInSec * 1000 });
          resend.startCooldown(result.resendAvailableInSec);
          banner.show({ tone: 'warning', title: 'New link sent', body: 'Use the newest email — earlier links no longer work.' });
        } catch (err) {
          if (err.code === 'RATE_LIMITED') resend.startCooldown(err.details.retryAfterSec ?? 30);
          else resend.setBusy(false);
          banner.show({ title: 'Couldn’t resend the email', body: err.message });
        }
      },
    });
    resend.startCooldown(Math.max(0, Math.ceil((registration.resendAvailableAt - Date.now()) / 1000)));

    function startOver() {
      store.set('prefillEmail', registration.email);
      store.set('registration', null);
      navigate('register');
    }

    function goToLogin() {
      store.set('prefillEmail', registration.email);
      store.set('registration', null);
      navigate('login');
    }

    const el = h(
      'div',
      { class: 'view' },
      h('div', { class: 'icon-tile' }, icon('mail', { size: 26 })),
      viewHeader({
        kicker: 'Step 2 of 3',
        title: 'Check your inbox',
        lead: [
          'We sent a verification link to ',
          h('strong', {}, registration.email),
          '. Open it on any device — this page continues automatically.',
        ],
      }),
      banner.el,
      statusCard,
      h(
        'div',
        { class: 'btn-row' },
        resend.el,
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: startOver }, 'Use a different email'),
      ),
      h(
        'p',
        { class: 'note view__footer' },
        `Can't find it? Check spam or promotions. Links expire after ${linkTtlHours} hours.`,
      ),
    );

    poller.start();

    return {
      el,
      destroy() {
        poller.stop();
        resend.destroy();
      },
    };
  },
};
