import 'server-only';
import nodemailer from 'nodemailer';

// Gmail SMTP sender (Nodemailer). Credentials live in .env.local:
//   GMAIL_SENDER         = the Gmail address the mail is sent FROM
//   GMAIL_APP_PASSWORD   = a 16-char Google "App Password" (NOT the normal password)
// Get an App Password: Google Account → Security → 2-Step Verification → App passwords.
function getTransport() {
  const user = process.env.GMAIL_SENDER;
  // Google shows the App Password in 4 space-separated groups; the real value
  // has no spaces, so strip any whitespace the user may have pasted.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) {
    throw new Error(
      'Email is not configured. Set GMAIL_SENDER and GMAIL_APP_PASSWORD in .env.local.',
    );
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
}

export async function sendPasswordResetEmail(to: string, resetLink: string) {
  const from = `Campus Conveyance <${process.env.GMAIL_SENDER}>`;
  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="margin:0 0 8px">Reset your password</h2>
      <p style="color:#555;line-height:1.5">
        We received a request to reset your Campus Conveyance password.
        Click the button below to choose a new one. This link expires in 1 hour.
      </p>
      <p style="margin:24px 0">
        <a href="${resetLink}"
           style="background:#6d5efc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">
          Reset password
        </a>
      </p>
      <p style="color:#888;font-size:13px;line-height:1.5">
        If the button doesn't work, copy this link into your browser:<br>
        <a href="${resetLink}" style="color:#6d5efc;word-break:break-all">${resetLink}</a>
      </p>
      <p style="color:#aaa;font-size:12px;margin-top:24px">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>`;

  await getTransport().sendMail({
    from,
    to,
    replyTo: process.env.GMAIL_SENDER,
    subject: 'Reset your Campus Conveyance password',
    // A plain-text alternative markedly improves inbox placement (HTML-only mail
    // with a bare link is a strong spam signal).
    text:
      `Reset your Campus Conveyance password\n\n` +
      `We received a request to reset your password. Open this link to choose a ` +
      `new one (expires in 1 hour):\n${resetLink}\n\n` +
      `If you didn't request this, you can ignore this email.`,
    html,
  });
}

export async function sendEmailOtpEmail(to: string, code: string) {
  const from = `Campus Conveyance <${process.env.GMAIL_SENDER}>`;
  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="margin:0 0 8px">Verify your email</h2>
      <p style="color:#555;line-height:1.5">
        Use the code below to verify your email address and continue your
        Campus Conveyance service-provider application. This code expires in
        10 minutes.
      </p>
      <p style="margin:24px 0">
        <span style="display:inline-block;background:#f2f0ff;color:#4634d1;font-size:30px;
          font-weight:700;letter-spacing:8px;padding:14px 26px;border-radius:12px">
          ${code}
        </span>
      </p>
      <p style="color:#aaa;font-size:12px;margin-top:24px">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>`;

  await getTransport().sendMail({
    from,
    to,
    replyTo: process.env.GMAIL_SENDER,
    subject: `${code} is your Campus Conveyance verification code`,
    text:
      `Verify your email\n\n` +
      `Your Campus Conveyance verification code is: ${code}\n` +
      `It expires in 10 minutes.\n\n` +
      `If you didn't request this, you can ignore this email.`,
    html,
  });
}

/** Forward a landing-page "Contact Us" inquiry to the platform inbox. */
export async function sendContactInquiryEmail(inquiry: {
  name: string;
  email: string;
  phone?: string;
  organization?: string;
  message: string;
}) {
  const from = `Campus Conveyance <${process.env.GMAIL_SENDER}>`;
  // Inquiries land in the platform inbox (CONTACT_INBOX overrides the sender).
  const to = process.env.CONTACT_INBOX || process.env.GMAIL_SENDER!;
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = [
    ['Name', inquiry.name],
    ['Email', inquiry.email],
    ['Phone', inquiry.phone || '—'],
    ['Organization', inquiry.organization || '—'],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 14px 6px 0;color:#888">${k}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`,
    )
    .join('');
  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
      <h2 style="margin:0 0 8px">New contact inquiry</h2>
      <p style="color:#555;line-height:1.5">Someone reached out via the Campus Conveyance landing page.</p>
      <table style="border-collapse:collapse;font-size:14px">${rows}</table>
      <p style="margin:18px 0 6px;color:#888;font-size:13px">Message</p>
      <div style="background:#f6f5ff;border-radius:10px;padding:14px 16px;white-space:pre-wrap;font-size:14px;line-height:1.5">${esc(inquiry.message)}</div>
      <p style="color:#aaa;font-size:12px;margin-top:20px">Reply directly to this email to answer ${esc(inquiry.name)}.</p>
    </div>`;

  await getTransport().sendMail({
    from,
    to,
    // Replying answers the visitor, not the sender mailbox.
    replyTo: `${inquiry.name} <${inquiry.email}>`,
    subject: `Contact inquiry from ${inquiry.name}`,
    text:
      `New contact inquiry\n\n` +
      `Name: ${inquiry.name}\nEmail: ${inquiry.email}\n` +
      `Phone: ${inquiry.phone || '—'}\nOrganization: ${inquiry.organization || '—'}\n\n` +
      `${inquiry.message}`,
    html,
  });
}

export async function sendSignupConfirmationEmail(to: string, confirmLink: string) {
  const from = `Campus Conveyance <${process.env.GMAIL_SENDER}>`;
  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="margin:0 0 8px">Confirm your account</h2>
      <p style="color:#555;line-height:1.5">
        Welcome to Campus Conveyance! Please confirm your email address to
        activate your account.
      </p>
      <p style="margin:24px 0">
        <a href="${confirmLink}"
           style="background:#6d5efc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">
          Confirm my email
        </a>
      </p>
      <p style="color:#888;font-size:13px;line-height:1.5">
        If the button doesn't work, copy this link into your browser:<br>
        <a href="${confirmLink}" style="color:#6d5efc;word-break:break-all">${confirmLink}</a>
      </p>
      <p style="color:#aaa;font-size:12px;margin-top:24px">
        If you didn't create this account, you can safely ignore this email.
      </p>
    </div>`;

  await getTransport().sendMail({
    from,
    to,
    replyTo: process.env.GMAIL_SENDER,
    subject: 'Confirm your Campus Conveyance account',
    // Plain-text alternative — improves inbox placement vs. HTML-only mail.
    text:
      `Confirm your Campus Conveyance account\n\n` +
      `Welcome! Please confirm your email address to activate your account by ` +
      `opening this link:\n${confirmLink}\n\n` +
      `If you didn't create this account, you can ignore this email.`,
    html,
  });
}
