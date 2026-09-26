/**
 * Unit tests for email template rendering.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fill, renderEmail } from '../src/modules/email/templates.js';

test('fill escapes values in HTML but not in plain text', () => {
  const vars = { name: '<b>Eve</b> & co' };
  assert.equal(fill('Hi {{ name }}', vars, { html: true }), 'Hi &lt;b&gt;Eve&lt;/b&gt; &amp; co');
  assert.equal(fill('Hi {{name}}', vars), 'Hi <b>Eve</b> & co');
});

test('fill throws on a missing variable', () => {
  assert.throws(() => fill('Hi {{ nobody }}', {}), /"nobody" was not provided/);
});

test('verification email renders every placeholder', () => {
  const email = renderEmail('verify-email', 'Verify your {{ appName }} account', {
    appName: 'MoneMapa',
    email: 'jane@company.com',
    name: 'Jane',
    link: 'http://localhost:3000/verified#token=abc&x=1',
    linkTtlHours: 24,
  });
  assert.equal(email.subject, 'Verify your MoneMapa account');
  assert.match(email.html, /href="http:\/\/localhost:3000\/verified#token=abc&amp;x=1"/);
  assert.match(email.text, /verified#token=abc&x=1/);
  assert.doesNotMatch(email.html + email.text, /{{/);
});

test('sign-in email has the code and no link', () => {
  const email = renderEmail('sign-in-code', '{{ code }} is your code', {
    appName: 'MoneMapa',
    email: 'jane@company.com',
    code: '048213',
    codeTtlMinutes: 5,
  });
  assert.equal(email.subject, '048213 is your code');
  assert.match(email.html, /048213/);
  assert.match(email.text, /048213/);
  assert.doesNotMatch(email.html, /<a\s/i);
  assert.doesNotMatch(email.html + email.text, /{{/);
});
