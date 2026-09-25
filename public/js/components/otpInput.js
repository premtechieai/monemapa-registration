/**
 * One-time-code input: N single-digit boxes that behave like one field.
 *
 *  - typing advances to the next box; Backspace on an empty box goes back
 *  - arrow keys move between boxes
 *  - pasting (or SMS/email autofill) fills every box at once
 *  - calls onComplete(code) when every box has a digit
 *
 * Returns { el, focus(), clear(), getCode(), setError(bool), setDisabled(bool) }.
 */
import { h } from '../core/dom.js';

export function otpInput({ length, onComplete, onChange = () => {} }) {
  const cells = Array.from({ length }, (_, i) =>
    h('input', {
      class: 'otp__cell',
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      // Lets iOS/Android offer the code from the email/SMS on the first box.
      autocomplete: i === 0 ? 'one-time-code' : 'off',
      'aria-label': `Digit ${i + 1} of ${length}`,
      maxLength: length, // allow a full paste into any box; we redistribute it
    }),
  );
  const el = h('div', { class: 'otp', role: 'group', 'aria-label': 'One-time code' }, cells);

  const getCode = () => cells.map((c) => c.value).join('');

  function refresh() {
    cells.forEach((c) => c.classList.toggle('is-filled', c.value !== ''));
    el.classList.remove('is-error');
    onChange(getCode());
    if (cells.every((c) => c.value !== '')) onComplete(getCode());
  }

  /** Spread a string of digits across boxes starting at `start`. */
  function fill(start, digits) {
    digits.split('').slice(0, length - start).forEach((d, k) => (cells[start + k].value = d));
    cells[Math.min(start + digits.length, length - 1)].focus();
  }

  cells.forEach((cell, i) => {
    cell.addEventListener('input', () => {
      const digits = cell.value.replace(/\D/g, '');
      if (digits.length > 1) {
        fill(i, digits); // paste or autofill
      } else {
        cell.value = digits;
        if (digits && i < length - 1) cells[i + 1].focus();
      }
      refresh();
    });

    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !cell.value && i > 0) {
        e.preventDefault();
        cells[i - 1].value = '';
        cells[i - 1].focus();
        refresh();
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        cells[i - 1].focus();
      } else if (e.key === 'ArrowRight' && i < length - 1) {
        e.preventDefault();
        cells[i + 1].focus();
      }
    });

    cell.addEventListener('focus', () => cell.select());
  });

  return {
    el,
    getCode,
    focus: () => (cells.find((c) => !c.value) ?? cells[0]).focus(),
    clear() {
      cells.forEach((c) => (c.value = ''));
      cells.forEach((c) => c.classList.remove('is-filled'));
      cells[0].focus();
    },
    setError(on) {
      // Re-trigger the shake animation on repeated errors.
      el.classList.remove('is-error');
      if (on) requestAnimationFrame(() => el.classList.add('is-error'));
    },
    setDisabled(disabled) {
      cells.forEach((c) => (c.disabled = disabled));
    },
  };
}
