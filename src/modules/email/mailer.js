/**
 * Mail transport.
 *
 *  - supabase mode: Nodemailer over SMTP, using config.email.smtp for the
 *    server and SMTP_USER / SMTP_PASSWORD from secrets.
 *  - sandbox mode:  nothing leaves the machine; messages go to the sandbox
 *    inbox shown at /sandbox (and are printed in the terminal).
 *
 * Both expose the same interface:
 *   send(message, meta)  message = { to, subject, html, text }
 *                        meta    = extra info the sandbox inbox displays
 *   verify()             check the SMTP connection and login
 */
import nodemailer from 'nodemailer';
import config from '../../config/index.js';
import { getSecrets } from '../../config/secrets.js';

const { from, replyTo, smtp } = config.email;
const fromHeader = { name: from.name, address: from.address };

function createSmtpMailer() {
  const secrets = getSecrets();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure, // true = TLS from the start (port 465); false = STARTTLS (port 587)
    requireTLS: !smtp.secure, // never send credentials over an unencrypted connection
    auth: { user: secrets.SMTP_USER, pass: secrets.SMTP_PASSWORD },
    connectionTimeout: smtp.connectionTimeoutMs,
    greetingTimeout: smtp.connectionTimeoutMs,
    socketTimeout: smtp.connectionTimeoutMs * 2,
  });

  return {
    async send(message) {
      const info = await transporter.sendMail({ from: fromHeader, replyTo: replyTo || undefined, ...message });
      return { messageId: info.messageId };
    },
    verify: () => transporter.verify(),
  };
}

async function createSandboxMailer() {
  const { deliverMail } = await import('../../sandbox/store.js');
  return {
    async send(message, meta = {}) {
      const stored = deliverMail({ ...meta, to: message.to, subject: message.subject, html: message.html });
      return { messageId: stored.id };
    },
    verify: async () => true,
  };
}

export const mailer = config.isSandbox ? await createSandboxMailer() : createSmtpMailer();
