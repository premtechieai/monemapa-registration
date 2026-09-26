/**
 * EmailService — the two emails this module sends.
 *
 *   sendVerificationEmail  after registration: link that activates the account
 *   sendSignInCode         every sign-in: one-time code, no link
 *
 * Content comes from ./templates, subjects from config.email.subjects.
 * Send failures are logged with the SMTP server's reply and surfaced to the
 * user as a friendly EMAIL_SEND_FAILED error.
 */
import config from '../../config/index.js';
import { Errors } from '../../lib/errors.js';
import logger from '../../lib/logger.js';
import { mailer } from './mailer.js';
import { renderEmail } from './templates.js';

async function send({ to, template, subject, vars, meta }) {
  const message = { to, ...renderEmail(template, subject, { appName: config.app.name, email: to, ...vars }) };

  // Stub mode (STUB_ON=true): render the email (so template errors still
  // surface) but don't contact the mail server.
  if (config.stub.enabled) {
    logger.info('[stub] Email not sent (STUB_ON=true)', { template, subject: message.subject });
    return;
  }

  try {
    const { messageId } = await mailer.send(message, meta);
    logger.info('Email sent', { template, messageId });
  } catch (err) {
    // err.response / responseCode carry the SMTP server's explanation (bad login, sender not allowed, ...).
    logger.error('Email send failed', {
      template,
      code: err.code,
      responseCode: err.responseCode,
      response: err.response,
      message: err.message,
      fix: 'Check email.smtp in config and SMTP_USER / SMTP_PASSWORD in secrets/.env; run `npm run check`',
    });
    throw Errors.emailSendFailed();
  }
}

/** Account activation email with a single-use verification link. */
export function sendVerificationEmail({ to, name, link }) {
  return send({
    to,
    template: 'verify-email',
    subject: config.email.subjects.verifyEmail,
    vars: { name, link, linkTtlHours: config.registration.linkTtlHours },
    meta: { kind: 'verify', link },
  });
}

/** Sign-in email containing only the one-time code. */
export function sendSignInCode({ to, code }) {
  return send({
    to,
    template: 'sign-in-code',
    subject: config.email.subjects.signInCode,
    vars: { code, codeTtlMinutes: Math.round(config.otp.ttlSec / 60) },
    meta: { kind: 'otp', code },
  });
}
