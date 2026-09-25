/**
 * Tiny DOM helpers.
 *
 * `h()` builds elements from plain values. Text is always inserted as text
 * nodes (never innerHTML), so user input such as a name can't inject markup.
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [props]  attributes; `class`, `style` (object), `dataset`,
 *                          `on<Event>` handlers, and `ref` (callback) are special
 * @param {...(Node|string|number|null|false|Array)} children
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'ref') value(el);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && typeof value !== 'string') el[key] = value; // e.g. checked, disabled
    else el.setAttribute(key, value === true ? '' : value);
  }

  append(el, children);
  return el;
}

/** Append children, flattening arrays and skipping null/false. */
export function append(parent, children) {
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Replace all children of `el`. */
export function replaceChildren(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Parse a trusted, static SVG string (icons only — never user data). */
export function svg(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}
