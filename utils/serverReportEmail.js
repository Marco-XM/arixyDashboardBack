// Email that delivers a server report to a client: branded header, the
// sender's personal message, a highlights row, a portal button, and the PDF
// attached. Table layout + inline styles so it renders in Gmail/Outlook/Apple
// Mail. The brand logo is an inline attachment referenced as cid:brand-logo.

const { periodLabel, serviceSummary, STATUS } = require('./serverReportPdf');

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function defaultReportMessage({ report, company, branding }) {
    const label = periodLabel(report.periodStart, report.periodEnd);
    return [
        `Hi ${company?.name || 'there'} team,`,
        '',
        `Please find attached your ${(report.title || 'Monthly Server Report').toLowerCase()} for ${label}. It covers the key performance metrics of your server, the status of each service we monitor, and the fixes and maintenance we carried out during the period.`,
        '',
        'You can also view and download it anytime from your client portal.',
        '',
        'Best regards,',
        branding?.brandName || 'Arixy Tech',
    ].join('\n');
}

function defaultReportSubject({ report, company }) {
    return `${report.title || 'Monthly Server Report'} · ${periodLabel(report.periodStart, report.periodEnd)} · ${company?.name || ''}`.replace(/ · $/, '');
}

function buildReportEmail({ report, company, branding, message, filename }) {
    const accent = /^#[0-9a-f]{6}$/i.test(branding?.accentColor || '') ? branding.accentColor : '#4F46E5';
    const brandName = branding?.brandName || 'Arixy Tech';
    const title = report.title || 'Monthly Server Report';
    const label = periodLabel(report.periodStart, report.periodEnd);
    const companyName = company?.name || '';
    const body = (message && message.trim()) || defaultReportMessage({ report, company, branding });
    const svc = serviceSummary((report.services || []).filter((s) => s && s.name));
    const fixesCount = (report.fixes || []).filter((f) => f && f.title).length;

    const bodyHtml = body
        .split(/\n\s*\n/)
        .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3F4459;">${esc(p).replace(/\n/g, '<br>')}</p>`)
        .join('');

    const stats = [];
    if (svc.total) stats.push({ value: `${svc.operational}/${svc.total}`, label: 'Services up', color: STATUS[svc.overall.key].color });
    if (fixesCount) stats.push({ value: String(fixesCount), label: fixesCount === 1 ? 'Task completed' : 'Tasks completed', color: accent });
    if (svc.overall) stats.push({ value: svc.overall.label, label: 'Overall status', color: STATUS[svc.overall.key].color, small: true });

    const statsHtml = stats.length ? `
      <tr><td style="padding:6px 32px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
          <tr>
            ${stats.map((s, i) => `
            <td valign="top" width="${Math.floor(100 / stats.length)}%" style="padding:${i ? '0 0 0 8px' : '0'};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FB;border:1px solid #E7E8F0;border-radius:12px;">
                <tr><td style="padding:14px 14px 13px;font-family:${FONT};">
                  <div style="width:18px;height:3px;border-radius:2px;background:${s.color};margin-bottom:10px;font-size:0;line-height:0;">&nbsp;</div>
                  <div style="font-size:${s.small ? '14px' : '22px'};line-height:1.25;font-weight:700;color:#0E0B1F;">${esc(s.value)}</div>
                  <div style="margin-top:4px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#7A7F96;font-weight:600;">${esc(s.label)}</div>
                </td></tr>
              </table>
            </td>`).join('')}
          </tr>
        </table>
      </td></tr>` : '';

    const contact = [branding?.website, branding?.email, branding?.phone].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
    const portalUrl = branding?.portalUrl || '';

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(title)} · ${esc(label)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F2F8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(`Your ${label} server report from ${brandName} is attached.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F2F8;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:18px;overflow:hidden;font-family:${FONT};">
      <tr><td style="background:#0E0B1F;padding:28px 32px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" style="padding-right:10px;"><img src="cid:brand-logo" width="34" height="34" alt="${esc(brandName)}" style="display:block;width:34px;height:34px;border:0;object-fit:contain;"></td>
          <td valign="middle" style="font-family:${FONT};font-size:16px;font-weight:700;color:#FFFFFF;">${esc(brandName)}</td>
        </tr></table>
        <div style="margin-top:30px;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#7EF0EA;">${esc(title)}</div>
        <div style="margin-top:8px;font-size:30px;line-height:1.15;font-weight:700;color:#FFFFFF;">${esc(label)}</div>
        ${companyName ? `<div style="margin-top:8px;font-size:15px;color:#A9A5CC;">Prepared for <strong style="color:#FFFFFF;">${esc(companyName)}</strong></div>` : ''}
      </td></tr>
      <tr><td style="height:4px;line-height:4px;font-size:0;background:#B517F5;background-image:linear-gradient(90deg,#4C1D95,#B517F5,#F9A8C9,#7AF2D0,#5FD3F3);">&nbsp;</td></tr>
      <tr><td style="padding:30px 32px 6px;">${bodyHtml}</td></tr>
      ${statsHtml}
      <tr><td style="padding:18px 32px 8px;">
        ${portalUrl ? `<a href="${esc(portalUrl)}" style="display:inline-block;background:${accent};color:#FFFFFF;font-family:${FONT};font-size:14px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:10px;">View in client portal</a>` : ''}
        <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#7A7F96;">The full report is attached as a PDF${filename ? ` (<span style="color:#454A61;">${esc(filename)}</span>)` : ''}.</p>
      </td></tr>
      <tr><td style="padding:26px 32px 28px;">
        <div style="border-top:1px solid #E7E8F0;padding-top:18px;font-size:12px;line-height:1.6;color:#7A7F96;">
          <strong style="color:#1F2335;">${esc(brandName)}</strong>${contact ? `<br>${contact}` : ''}
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

    const text = [
        `${title} — ${label}${companyName ? ` — ${companyName}` : ''}`,
        '',
        body,
        '',
        svc.total ? `Services up: ${svc.operational}/${svc.total} (${svc.overall.label})` : null,
        fixesCount ? `Fixes & tasks done: ${fixesCount}` : null,
        portalUrl ? `Client portal: ${portalUrl}` : null,
        '',
        `The full report is attached as a PDF${filename ? ` (${filename})` : ''}.`,
    ].filter((l) => l !== null).join('\n');

    return { html, text };
}

module.exports = { buildReportEmail, defaultReportMessage, defaultReportSubject };
