/**
 * Celebration visuals for the welcome screen: an animated check mark and a
 * short burst of confetti. Both are decorative (aria-hidden) and are
 * disabled by CSS for users who prefer reduced motion.
 */
import { h, svg } from '../core/dom.js';

const COLORS = ['#8839ef', '#ea76cb', '#fe640b', '#df8e1d', '#40a02b', '#209fb5', '#1e66f5'];

export function successMark() {
  return h(
    'div',
    { class: 'success-mark', 'aria-hidden': 'true' },
    svg(
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#eff1f5" stroke-width="3" stroke-linecap="square"><path d="M20 6 9 17l-5-5"/></svg>',
    ),
  );
}

/**
 * Confetti overlay. Append it to a `position: relative` container.
 * It removes itself once the animation is over.
 */
export function confetti({ pieces = 48 } = {}) {
  let longest = 0;
  const bits = Array.from({ length: pieces }, (_, i) => {
    const delay = Math.random() * 0.9;
    const duration = 1.8 + Math.random() * 1.6;
    longest = Math.max(longest, delay + duration);
    return h('span', {
      class: 'confetti__piece',
      style: {
        left: `${Math.random() * 100}%`,
        width: `${6 + Math.random() * 8}px`,
        height: `${4 + Math.random() * 10}px`,
        background: COLORS[i % COLORS.length],
        borderRadius: i % 3 === 0 ? '50%' : '2px',
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
      },
    });
  });

  const el = h('div', { class: 'confetti', 'aria-hidden': 'true' }, bits);
  setTimeout(() => el.remove(), (longest + 0.5) * 1000);
  return el;
}
