import { isActiveSuperAdmin } from '@/features/admin/guard';
import { getAdminReport } from '@/features/admin/repository';

// Cookie-authed, per-request export — declare the runtime explicitly to match
// the other API/route handlers rather than relying on the dynamic default.
export const runtime = 'nodejs';

// GET /aevinite/report.csv — a real spreadsheet export of the admin report
// (issue 3: "Download report" previously only opened the browser print dialog).
// Route handlers aren't wrapped by the (panel) layout guard, so we check the
// role here ourselves.
export async function GET(request: Request) {
  if (!(await isActiveSuperAdmin())) {
    // A plain 403 body was downloaded as a file literally containing the word
    // "Forbidden" (e.g. when the session had expired). Redirect to the admin
    // login instead so the user just re-authenticates.
    return Response.redirect(new URL('/aevinite/login', request.url), 303);
  }

  const report = await getAdminReport();
  const rupees = (cents: number) => ((cents || 0) / 100).toFixed(2);

  // RFC-4180 escaping: quote fields with comma/quote/newline/CR; double any
  // quotes. Plus a formula-injection guard: a STRING cell (e.g. an agency-set
  // provider name) starting with a formula trigger (= + - @, tab, CR) is
  // prefixed with a quote so Excel/Sheets treat it as text, not a live formula.
  // Numbers are left untouched.
  const cell = (v: string | number) => {
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (...cells: (string | number)[]) => cells.map(cell).join(',');

  const lines: string[] = [
    row('Campus Conveyance — Admin Report'),
    row('Generated', new Date(report.generatedAt).toISOString()),
    '',
    row('Metric', 'Value'),
    row('Pending requests', report.counts.requests),
    row('Service providers', report.counts.agencies),
    row('Students', report.counts.students),
    row('Colleges & schools', report.counts.colleges),
    '',
    row('Payments', 'Count', 'Amount (INR)'),
    row('Paid', report.payments.paidCount, rupees(report.payments.paidCents)),
    row('Unpaid', report.payments.unpaidCount, rupees(report.payments.unpaidCents)),
    '',
    row('Service provider', 'Buses', 'Vans', 'Students'),
    ...report.providers.map((p) => row(p.name, p.buses, p.vans, p.students)),
    row('Total', report.totals.buses, report.totals.vans, report.totals.students),
  ];

  const csv = '﻿' + lines.join('\r\n'); // BOM so Excel reads UTF-8 correctly
  const filename = `campus-conveyance-report-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
