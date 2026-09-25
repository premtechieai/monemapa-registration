/**
 * Flow progress: a numbered step list in the sidebar (desktop/tablet) and a
 * segmented bar (mobile). Both render from the same data; CSS decides which
 * one is visible.
 */
import { h, replaceChildren } from '../core/dom.js';

const FLOWS = {
  register: {
    kicker: 'New account',
    title: 'Create an account in three steps',
    steps: [
      ['Your details', 'Name and email'],
      ['Verify email', 'Confirm via link'],
      ['Welcome', 'Account active'],
    ],
  },
  login: {
    kicker: 'Returning user',
    title: 'Sign in with a one-time code',
    steps: [
      ['Email', 'Registered address'],
      ['One-time code', 'Sent to your inbox'],
      ['Dashboard', 'Signed in'],
    ],
  },
};

/**
 * @param {object} args
 * @param {'register'|'login'} args.flow
 * @param {number} args.step      zero-based current step
 * @param {boolean} args.complete true when the last step is finished
 */
export function renderStepper({ flow, step, complete }) {
  const { kicker, title, steps } = FLOWS[flow];

  const items = steps.map(([label, hint], i) => {
    const done = i < step || (i === step && complete);
    const current = i === step && !done;
    return h(
      'li',
      { class: `step${done ? ' is-done' : ''}${current ? ' is-current' : ''}`, 'aria-current': current ? 'step' : null },
      h('div', { class: 'step__num' }, `0${i + 1}`),
      h(
        'div',
        {},
        h('div', { class: 'step__label' }, label),
        h('div', { class: 'step__status' }, done ? 'Done' : current ? 'In progress' : hint),
      ),
    );
  });

  replaceChildren(
    document.getElementById('steps-aside'),
    h('div', {}, h('div', { class: 'steps-aside__kicker' }, kicker), h('div', { class: 'steps-aside__title' }, title)),
    h('ol', { class: 'steps-list' }, items),
    h(
      'p',
      { class: 'steps-aside__note' },
      'No passwords to remember. Every sign-in uses a one-time code sent to your verified email.',
    ),
  );

  replaceChildren(
    document.getElementById('steps-progress'),
    h(
      'div',
      { class: 'steps-progress__bars', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': steps.length, 'aria-valuenow': step + 1 },
      steps.map((_, i) => h('div', { class: `steps-progress__bar${i <= step ? ' is-active' : ''}` })),
    ),
    h('div', { class: 'steps-progress__caption' }, `Step ${step + 1} of ${steps.length} · ${steps[step][0]}`),
  );
}
