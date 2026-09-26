/**
 * Email template rendering.
 *
 * Templates live in ./templates as <name>.html and <name>.txt (plain-text
 * fallback for clients that don't show HTML). Placeholders use {{ name }}.
 * Values are HTML-escaped in the .html version, so a user's name can't inject
 * markup into an email. A missing variable is a programming error and throws.
 *
 * Templates are re-read on every send outside production, so edits show up
 * without restarting; in production they are cached after first use.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../config/index.js';

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const cache = new Map();

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function readTemplate(file) {
  if (config.isProduction && cache.has(file)) return cache.get(file);
  const content = fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8');
  cache.set(file, content);
  return content;
}

/**
 * Replace {{ placeholders }} in `template` with values from `vars`.
 * @param {string} template
 * @param {Record<string, string|number>} vars
 * @param {{ html?: boolean }} [options] escape values for HTML
 */
export function fill(template, vars, { html = false } = {}) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Email template variable "${key}" was not provided`);
    return html ? escapeHtml(vars[key]) : String(vars[key]);
  });
}

/**
 * Render an email from its template files.
 * @param {string} name     template base name, e.g. "verify-email"
 * @param {string} subject  subject line (may contain placeholders)
 * @param {object} vars     placeholder values
 * @returns {{ subject: string, html: string, text: string }}
 */
export function renderEmail(name, subject, vars) {
  return {
    subject: fill(subject, vars),
    html: fill(readTemplate(`${name}.html`), vars, { html: true }),
    text: fill(readTemplate(`${name}.txt`), vars),
  };
}
