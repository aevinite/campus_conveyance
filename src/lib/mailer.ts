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

export interface BookingEmailDetails {
  studentName: string | null;
  institutionName: string | null;
  routeName: string | null;
  busNumber: string | null;
  busModel: string | null;
  isAc: boolean | null;
  registrationNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  conductorName: string | null;
  conductorPhone: string | null;
  agencyName: string | null;
  pickupName: string | null;
  departureTime: string | null; // "HH:MM:SS"
  fare: string | null; // formatted, e.g. "₹1,200"
  methodLabel: string | null;
  paidAt: string | null; // formatted IST timestamp
  bookingRef: string; // short booking reference
}

/** Booking-confirmed mail sent to the student's signup email after payment. */
export async function sendBookingConfirmationEmail(to: string, d: BookingEmailDetails) {
  const from = `Campus Conveyance <${process.env.GMAIL_SENDER}>`;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bus = [
    d.busNumber ? `Bus ${d.busNumber}` : null,
    d.busModel,
    d.isAc == null ? null : d.isAc ? 'AC' : 'Non-AC',
  ]
    .filter(Boolean)
    .join(' · ');
  const rows: [string, string | null][] = [
    ['School / College', d.institutionName],
    ['Route', d.routeName],
    ['Bus', bus || null],
    ['Registration no.', d.registrationNo],
    ['Driver', [d.driverName, d.driverPhone].filter(Boolean).join(' · ') || null],
    ['Conductor', [d.conductorName, d.conductorPhone].filter(Boolean).join(' · ') || null],
    ['Agency', d.agencyName],
    ['Pickup stop', d.pickupName],
    ['Departure', d.departureTime],
    ['Fare paid', d.fare],
    ['Paid via', d.methodLabel],
    ['Paid on', d.paidAt],
    ['Booking reference', d.bookingRef],
  ];
  const tableHtml = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 16px 7px 0;color:#888;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:7px 0;font-weight:600">${esc(v as string)}</td></tr>`,
    )
    .join('');
  const tableText = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
      <h2 style="margin:0 0 8px">✅ Your seat is confirmed${d.studentName ? `, ${esc(d.studentName.split(' ')[0])}` : ''}!</h2>
      <p style="color:#555;line-height:1.5">
        Payment received — your bus seat is booked. Here are your ride details:
      </p>
      <table style="border-collapse:collapse;font-size:14px;margin:14px 0;background:#f6f5ff;border-radius:12px;padding:8px" cellpadding="0">
        <tr><td style="padding:14px 16px 4px">
          <table style="border-collapse:collapse;font-size:14px">${tableHtml}</table>
        </td></tr>
        <tr><td style="height:10px"></td></tr>
      </table>
      <p style="margin:22px 0">
        <a href="${site}/student/bookings"
           style="background:#6d5efc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">
          View my booking
        </a>
      </p>
      <p style="color:#aaa;font-size:12px;margin-top:22px">
        The driver or bus may occasionally change for a day — the app always
        shows the latest details. Have a safe ride!
      </p>
    </div>`;

  await getTransport().sendMail({
    from,
    to,
    replyTo: process.env.GMAIL_SENDER,
    subject: `Booking confirmed — ${d.routeName ?? 'your bus seat'}${d.institutionName ? ` to ${d.institutionName}` : ''}`,
    text:
      `Your seat is confirmed!\n\n` +
      `Payment received — your bus seat is booked.\n\n${tableText}\n\n` +
      `View my booking: ${site}/student/bookings\n\nHave a safe ride!`,
    html,
  });
}

/**
 * Booking-lifecycle mail (reserved / waitlisted / rejected / promoted /
 * expired / cancelled, and confirmed for parents). The trigger already composed
 * a human title + body; this just wraps them in the branded shell and sends. It
 * is called only by the outbox drainer, which is entirely best-effort.
 */
export async function sendBookingLifecycleEmail(
  to: string,
  title: string,
  body: string,
) {
  const from = `Campus Conveyance <${process.env.GMAIL_SENDER}>`;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="margin:0 0 8px">${esc(title)}</h2>
      <p style="color:#555;line-height:1.5">${esc(body)}</p>
      <p style="margin:24px 0">
        <a href="${site}/login"
           style="background:#6d5efc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">
          Open Campus Conveyance
        </a>
      </p>
      <p style="color:#aaa;font-size:12px;margin-top:24px">
        You're receiving this because you (or your linked student) have a booking
        on Campus Conveyance.
      </p>
    </div>`;

  await getTransport().sendMail({
    from,
    to,
    replyTo: process.env.GMAIL_SENDER,
    subject: `${title} — Campus Conveyance`,
    text: `${title}\n\n${body}\n\nOpen Campus Conveyance: ${site}/login`,
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
        Button not working?
        <a href="${confirmLink}" style="color:#6d5efc;font-weight:600;text-decoration:underline">Confirm your email here</a>.
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
