/**
 * Desktop / Mobile preview toolbar (from the design files): a title plus
 * "Desktop", "Mobile" and "Reset" buttons above the page frame.
 *
 * "Mobile" narrows the frame to a phone width; the layout inside switches via
 * CSS container queries on the frame. The choice is remembered (localStorage),
 * so it carries over between the registration pages and the dashboard.
 * Shown when config.ui.showPreviewToggle is true; hidden on phone screens,
 * where the page is already in mobile layout.
 */
import { h, replaceChildren, svg } from '../core/dom.js';

const STORAGE_KEY = 'monemapa.previewMode';

function readMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'mobile' ? 'mobile' : 'desktop';
  } catch {
    return 'desktop'; // storage blocked (private mode, etc.)
  }
}

function saveMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* not remembered; still works for this page */
  }
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.slot    where the toolbar is rendered
 * @param {HTMLElement} opts.frame   element that gets the `is-mobile` class
 * @param {string} opts.kicker       small caption, e.g. "MoneMapa · auth/registration v1.0"
 * @param {string} opts.title        toolbar title
 * @param {Function} opts.onReset    what "Reset" does on this page
 */
export function mountPreviewToggle({ slot, frame, kicker, title, onReset }) {
  const makeButton = (label, mode) =>
    h('button', { type: 'button', class: 'btn preview-bar__btn', 'aria-pressed': 'false', onClick: () => apply(mode) }, label);
  const desktop = makeButton('Desktop', 'desktop');
  const mobile = makeButton('Mobile', 'mobile');

  function apply(mode) {
    frame.classList.toggle('is-mobile', mode === 'mobile');
    for (const [btn, m] of [[desktop, 'desktop'], [mobile, 'mobile']]) {
      const on = m === mode;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('btn-primary', on);
      btn.classList.toggle('btn-secondary', !on);
    }
    saveMode(mode);
  }

  const reset = h(
    'button',
    { type: 'button', class: 'btn btn-ghost preview-bar__reset', onClick: onReset },
    svg('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'),
    'Reset',
  );

  replaceChildren(
    slot,
    h('div', { class: 'preview-bar__text' }, h('div', { class: 'kicker' }, kicker), h('div', { class: 'preview-bar__title' }, title)),
    h('div', { class: 'preview-bar__actions', role: 'group', 'aria-label': 'Preview size' }, desktop, mobile, reset),
  );
  slot.hidden = false;
  apply(readMode());
}
