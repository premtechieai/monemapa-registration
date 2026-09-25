/**
 * Front-end entry point.
 *
 * Loads config, wires the router to the views, and handles the view
 * lifecycle: tear down the old view (timers, pollers), render the new one,
 * update the step indicator, and move focus for keyboard/screen-reader users.
 *
 * View contract (see js/views/*):
 *   { flow, step, complete?, title, render(ctx) → { el, autofocus?, destroy?, redirect? } }
 */
import { loadConfig } from './core/config.js';
import { createRouter } from './core/router.js';
import { h, replaceChildren } from './core/dom.js';
import { renderStepper } from './components/stepper.js';
import { alertBox } from './components/ui.js';

import registerView from './views/registerView.js';
import verifyView from './views/verifyView.js';
import welcomeView from './views/welcomeView.js';
import loginView from './views/loginView.js';
import otpView from './views/otpView.js';
import dashboardView from './views/dashboardView.js';

const views = {
  register: registerView,
  verify: verifyView,
  welcome: welcomeView,
  login: loginView,
  otp: otpView,
  dashboard: dashboardView,
};

const outlet = document.getElementById('view');
let current = null; // the mounted view instance

async function boot() {
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    replaceChildren(outlet, alertBox({ title: 'The app failed to start', body: err.message }));
    return;
  }

  // Local sandbox: nothing is really emailed, so point testers at the mock inbox.
  if (config.sandbox) {
    document.body.append(
      h('a', { class: 'sandbox-pill', href: '/sandbox', target: '_blank', rel: 'noopener' }, 'Sandbox mode · Open inbox ↗'),
    );
  }

  const router = createRouter({
    routes: config.routes,
    views,
    fallback: 'register',
    onChange: (name, view) => mount(view),
  });

  function mount(view) {
    current?.destroy?.();
    current = null;

    const instance = view.render({ config, navigate: router.navigate });
    if (instance.redirect) return router.navigate(instance.redirect, { replace: true });

    current = instance;
    document.title = `${config.appName} · ${view.title}`;
    renderStepper({ flow: view.flow, step: view.step, complete: Boolean(view.complete) });
    replaceChildren(outlet, instance.el);

    // Focus the main input when there is one, otherwise the heading, so
    // screen readers announce the new screen.
    const target = instance.autofocus ?? outlet.querySelector('h1');
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    window.scrollTo({ top: 0 });
  }

  router.start();
}

boot().catch((err) => {
  replaceChildren(outlet, h('p', {}, `Unexpected error: ${err.message}`));
});
