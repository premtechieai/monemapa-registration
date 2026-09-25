/**
 * Inline SVG icons (Lucide-style, matching the design). Static markup only.
 */
import { svg } from '../core/dom.js';

const PATHS = {
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  mail: '<rect width="20" height="16" x="2" y="4"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
};

/** @param {keyof PATHS} name */
export function icon(name, { size = 16, strokeWidth = 2, className = '' } = {}) {
  return svg(
    `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="${strokeWidth}" stroke-linecap="square" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`,
  );
}
