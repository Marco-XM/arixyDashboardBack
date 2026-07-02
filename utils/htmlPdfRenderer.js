const path = require('path');
const fs = require('fs');
const { hasArabicText, getArabicFontFaceCss } = require('./arabicText');
const { numberToWords, numberToWordsWithCurrency } = require('./numberToWords');
const { htmlToPdfBuffer } = require('./pdfBrowser');

/* ─── helpers (ported from Acerta) ─────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Wrap text in a direction-aware span (RTL for Arabic).
function dirSpan(text) {
  if (text === 0) text = '0';
  if (!text) return '';
  const cls = hasArabicText(text) ? 'arabic' : 'latin';
  return `<span class="${cls}">${esc(text)}</span>`;
}

/* ─── Arixy variable resolver ──────────────────────────────── */
// context = { data, company, subscription, service, document }
// `data` holds user-filled values for arbitrary template variables. Built-in
// keys resolve from the company / subscription / document; anything else falls
// back to data[key], then to the literal {{key}} so authors see what's missing.
function buildReplaceVariables(context = {}) {
  const { data = {}, company = {}, subscription = null, service = null, document = {} } = context;

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '');
  const monthName = (m) => ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m)] || '';

  const builtins = {
    // Company
    companyName: () => company.name || 'N/A',
    companyEmail: () => company.contactEmail || '',
    companyPhone: () => company.phone || '',
    companyAddress: () => company.address || '',
    companyWebsite: () => company.website || '',
    companyIndustry: () => company.industry || '',
    // Document
    documentTitle: () => document.title || '',
    contractNumber: () => document.number || data.contractNumber || 'N/A',
    contractDate: () => fmtDate(document.issueDate || document.createdAt) || 'N/A',
    // Maintenance-report period
    periodMonth: () => monthName(document.period?.month) || '',
    periodYear: () => (document.period?.year ? String(document.period.year) : ''),
    period: () => {
      const mm = monthName(document.period?.month);
      const yy = document.period?.year || '';
      return [mm, yy].filter(Boolean).join(' ');
    },
    // Subscription / service
    serviceName: () => service?.name || subscription?.serviceName || data.serviceName || '',
    servicePrice: () => {
      const amt = subscription?.price?.amount;
      const cur = subscription?.price?.currency || 'USD';
      return amt != null ? `${amt} ${cur}` : (data.servicePrice || '');
    },
    servicePriceInWords: () => {
      const amt = subscription?.price?.amount;
      const cur = subscription?.price?.currency || 'USD';
      return amt != null ? numberToWordsWithCurrency(amt, cur) : '';
    },
    billingCycle: () => subscription?.billingCycle || data.billingCycle || '',
    // Dates
    todayDate: () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    currentDate: () => new Date().toLocaleDateString(),
  };

  const getVar = (rawName) => {
    const varName = String(rawName).trim();
    if (builtins[varName]) return builtins[varName]();
    if (Object.prototype.hasOwnProperty.call(data, varName) && data[varName] !== '') return data[varName];
    return `{{${varName}}}`;
  };

  // Replace {{var}}, {{var|bold}}, {{var|words}}, and [text](url) → HTML.
  return function replaceVars(text) {
    if (!text) return '';
    let result = String(text);
    // Links
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
      if (!u.startsWith('http') && !u.startsWith('mailto:')) u = 'https://' + u;
      return `<a href="${esc(u)}" style="color:#0000EE;text-decoration:underline">${dirSpan(t)}</a>`;
    });
    // bold+words combos
    result = result.replace(/\{\{([^}|]+)\|bold\|words\}\}/g, (_, v) => wordsBold(getVar(v)));
    result = result.replace(/\{\{([^}|]+)\|words\|bold\}\}/g, (_, v) => wordsBold(getVar(v)));
    // bold
    result = result.replace(/\{\{([^}|]+)\|bold\}\}/g, (_, v) => `<strong>${dirSpan(getVar(v))}</strong>`);
    // words
    result = result.replace(/\{\{([^}|]+)\|words\}\}/g, (_, v) => {
      const raw = getVar(v.trim());
      const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
      return dirSpan(isNaN(num) ? raw : numberToWords(num));
    });
    // normal
    result = result.replace(/\{\{([^}]+)\}\}/g, (_, v) => dirSpan(getVar(v)));
    return result;
  };

  function wordsBold(raw) {
    const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
    return `<strong>${dirSpan(isNaN(num) ? raw : numberToWords(num))}</strong>`;
  }
}

/* ─── dynamic table rows (Arixy line items) ────────────────── */
// data.lineItems: [{ description, quantity, unitPrice, amount, currency }]
function getLineItemRows(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const computeAmount = (it) => (it.amount != null && it.amount !== '')
    ? Number(it.amount)
    : Number(it.quantity || 0) * Number(it.unitPrice || 0);
  const rows = items.map((it, i) => [
    String(i + 1),
    it.description || '',
    String(it.quantity ?? ''),
    String(it.unitPrice ?? ''),
    String(computeAmount(it) || ''),
  ]);
  const total = items.reduce((s, it) => s + (computeAmount(it) || 0), 0);
  const currency = items[0]?.currency || data.currency || 'USD';
  if (items.length) rows.push(['', 'Total', '', '', `${total} ${currency}`]);
  return rows;
}

/* ─── section renderer (ported from Acerta, Arixy dynamic sources) ── */
function renderSectionHtml(section, replaceVars, context) {
  const type = section.type || 'text';
  const fontSize = section.fontSize || 11;
  const color = section.textColor || '#000000';
  const align = section.alignment || 'left';
  const bold = section.isBold;
  let html = '';

  const embedLocal = (src) => {
    if (!src || src.startsWith('http') || src.startsWith('data:')) return src;
    const abs = path.join(__dirname, '..', src.replace(/^[/\\]+/, ''));
    if (fs.existsSync(abs)) {
      const b64 = fs.readFileSync(abs).toString('base64');
      const ext = path.extname(abs).slice(1) || 'png';
      return `data:image/${ext};base64,${b64}`;
    }
    return src;
  };

  // Logo
  if (section.logoURL && section.logoURL.trim()) {
    const w = section.logoWidth || 150;
    const h = section.logoHeight || 80;
    const la = section.logoAlignment || 'center';
    const ta = la === 'center' ? 'center' : la === 'right' ? 'right' : 'left';
    html += `<div style="text-align:${ta};margin-bottom:6px"><img src="${embedLocal(section.logoURL)}" style="max-width:${w}px;max-height:${h}px" /></div>`;
  }

  // Title
  if (section.title && section.title.trim()) {
    html += `<div class="section-title" style="font-size:14px;font-weight:700;color:${color};text-align:${align};margin-bottom:6px">${replaceVars(section.title)}</div>`;
  }

  if (type === 'text') {
    const content = replaceVars(section.content || '');
    const fw = bold ? 'font-weight:700;' : '';
    html += `<div style="font-size:${fontSize}px;color:${color};text-align:${align};${fw}white-space:pre-wrap">${content}</div>`;
  } else if (type === 'bulletList') {
    const items = section.bulletItems || [];
    const style = section.bulletStyle || 'dot';
    const listType = ['number', 'letter', 'letterUpper', 'roman'].includes(style) ? 'ol' : 'ul';
    let listStyle = 'disc';
    if (style === 'dash') listStyle = '"- "';
    if (style === 'arrow') listStyle = '"\\2192  "';
    if (style === 'number') listStyle = 'decimal';
    if (style === 'letter') listStyle = 'lower-alpha';
    if (style === 'letterUpper') listStyle = 'upper-alpha';
    if (style === 'roman') listStyle = 'lower-roman';
    const fw = bold ? 'font-weight:700;' : '';
    html += `<${listType} style="font-size:${fontSize}px;color:${color};text-align:${align};${fw}list-style-type:${listStyle};padding-left:${section.bulletIndent || 20}px">`;
    items.forEach((item) => { html += `<li>${replaceVars(item || '')}</li>`; });
    html += `</${listType}>`;
  } else if (type === 'table' && section.tableData) {
    const headers = section.tableData.headers || [];
    let rows = section.tableData.rows || [];
    if (section.tableData.dynamicSource === 'lineItems') {
      rows = [...rows, ...getLineItemRows(context.data || {})];
    }
    html += `<table style="width:100%;border-collapse:collapse;font-size:${fontSize}px;color:${color};margin-top:4px">`;
    if (headers.length) {
      html += '<thead><tr>';
      headers.forEach((h) => { html += `<th style="border:1px solid #ccc;padding:4px 6px;background:#f3f4f6;text-align:left">${replaceVars(h || '')}</th>`; });
      html += '</tr></thead>';
    }
    html += '<tbody>';
    rows.forEach((row, ri) => {
      const isLast = ri === rows.length - 1;
      const isTotal = isLast && section.tableData?.dynamicSource && Array.isArray(row) && row.some((c) => String(c).toLowerCase() === 'total');
      const bg = isTotal ? 'background:#e5e7eb;font-weight:700;' : (ri % 2 === 1 ? 'background:#f9fafb;' : '');
      html += `<tr style="${bg}">`;
      (Array.isArray(row) ? row : []).forEach((cell) => {
        html += `<td style="border:1px solid #ccc;padding:4px 6px">${replaceVars(String(cell == null ? '' : cell))}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
  } else if (type === 'link') {
    let url = replaceVars(section.linkURL || '');
    if (url && !url.startsWith('http') && !url.startsWith('mailto:')) url = 'https://' + url;
    const linkText = replaceVars(section.linkText || section.title || 'Click here');
    html += `<div style="font-size:${fontSize}px;text-align:${align}"><a href="${esc(url)}" style="color:#0000EE;text-decoration:underline">${linkText}</a></div>`;
  } else if (type === 'image') {
    const w = section.imageWidth || 200;
    const h = section.imageHeight || 150;
    const ia = section.imageAlignment || 'center';
    const ta = ia === 'center' ? 'center' : ia === 'right' ? 'right' : 'left';
    const src = embedLocal(section.imageURL || '');
    if (src) html += `<div style="text-align:${ta}"><img src="${src}" style="max-width:${w}px;max-height:${h}px" /></div>`;
  } else if (type === 'signatures') {
    // Signatures are provided per-document via data.signatures: [{ name, imageURL }]
    const sigs = Array.isArray(context.data?.signatures) ? context.data.signatures : [];
    const sa = section.signatureAlignment || 'left';
    const ta = sa === 'center' ? 'center' : sa === 'right' ? 'right' : 'left';
    const showName = section.showSignatureName !== false;
    html += `<div style="display:flex;gap:24px;flex-wrap:wrap;text-align:${ta}">`;
    sigs.forEach((sig) => {
      html += `<div style="min-width:180px;margin-bottom:10px">`;
      if (showName) html += `<div style="font-weight:700;font-size:${fontSize}px;margin-bottom:4px">${esc(sig.name || 'Signature')}</div>`;
      if (sig.imageURL) html += `<img src="${embedLocal(sig.imageURL)}" style="max-width:200px;max-height:80px;display:block" />`;
      html += `<div style="border-bottom:1px solid #000;width:200px;margin:6px 0"></div>`;
      html += '</div>';
    });
    html += '</div>';
  }

  return html;
}

/* ─── main renderer ────────────────────────────────────────── */
function buildHtml(template, context) {
  const sections = (template?.customSections || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const replaceVars = buildReplaceVariables(context);

  const css = `
    ${getArabicFontFaceCss()}
    * { box-sizing: border-box; }
    body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; margin: 0; padding: 0; color: #111827; font-size: 11px; line-height: 1.5; }
    .header { text-align: center; font-size: 20px; font-weight: 700; margin-bottom: 18px; }
    .section { margin-bottom: 14px; page-break-inside: avoid; }
    .arabic { font-family: 'Amiri', 'Arial', sans-serif; direction: rtl; unicode-bidi: bidi-override; font-size: inherit; }
    .latin { direction: ltr; font-size: inherit; }
    a { color: #0000EE; text-decoration: underline; }
    table { border-collapse: collapse; width: 100%; font-size: inherit; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; font-size: inherit; }
    th { background: #f3f4f6; font-weight: 700; }
  `;

  const header = template?.headerText ? `<div class="header">${replaceVars(template.headerText)}</div>` : '';

  const sectionsHtml = sections.map((sec) => {
    const pb = sec.pageBreakBefore ? 'page-break-before:always;' : '';
    const width = sec.width === 'half' ? 'width:48%;display:inline-block;vertical-align:top;margin-right:2%;' : '';
    return `<div class="section" style="${pb}${width}">${renderSectionHtml(sec, replaceVars, context)}</div>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8" /><style>${css}</style></head><body>${header}${sectionsHtml}</body></html>`;
}

// Render a template + context into a PDF Buffer.
async function renderTemplateToPdfBuffer(template, context) {
  const html = buildHtml(template, context);
  return htmlToPdfBuffer(html);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Page/block renderer — ported from Acerta's ContractTemplateEditor pipeline,
 * with the contract-specific data resolver replaced by Arixy's (company /
 * subscription / document / line items / signatures).
 * ════════════════════════════════════════════════════════════════════════ */

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDateLong = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '');

function embedLocalImage(src) {
  if (!src || src.startsWith('http') || src.startsWith('data:')) return src;
  const abs = path.join(__dirname, '..', src.replace(/^[/\\]+/, ''));
  if (fs.existsSync(abs)) {
    const b64 = fs.readFileSync(abs).toString('base64');
    const ext = path.extname(abs).slice(1) || 'png';
    return `data:image/${ext};base64,${b64}`;
  }
  return src;
}

function lineItemsTotal(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const total = items.reduce((s, it) => s + ((it.amount != null && it.amount !== '') ? Number(it.amount) : Number(it.quantity || 0) * Number(it.unitPrice || 0)), 0);
  const currency = items[0]?.currency || data.currency || 'USD';
  return { total, currency };
}

// Inline (single-value) data-var resolution.
function getInlineValue(key, ctx) {
  const { data = {}, company = {}, subscription = null, service = null, document = {} } = ctx;
  switch (key) {
    case 'company_name': return company.name || '';
    case 'company_email': return company.contactEmail || '';
    case 'company_phone': return company.phone || '';
    case 'company_address': return company.address || '';
    case 'company_website': return company.website || '';
    case 'company_industry': return company.industry || '';
    case 'document_title': return document.title || '';
    case 'contract_number': return document.number || data.contractNumber || '';
    case 'contract_date': return fmtDateLong(document.issueDate || document.createdAt);
    case 'current_date': return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    case 'period_month': return MONTHS[Number(document.period?.month)] || '';
    case 'period_year': return document.period?.year ? String(document.period.year) : '';
    case 'period': return [MONTHS[Number(document.period?.month)] || '', document.period?.year || ''].filter(Boolean).join(' ');
    case 'service_name': return service?.name || subscription?.serviceName || data.serviceName || '';
    case 'service_price': { const a = subscription?.price?.amount; const c = subscription?.price?.currency || 'USD'; return a != null ? `${a} ${c}` : (data.servicePrice || ''); }
    case 'service_price_words': { const a = subscription?.price?.amount; const c = subscription?.price?.currency || 'USD'; return a != null ? numberToWordsWithCurrency(a, c) : ''; }
    case 'billing_cycle': return subscription?.billingCycle || data.billingCycle || '';
    case 'total_price': { const { total, currency } = lineItemsTotal(data); return `${total} ${currency}`; }
    case 'total_price_words': { const { total, currency } = lineItemsTotal(data); return numberToWordsWithCurrency(total, currency); }
    default:
      if (Object.prototype.hasOwnProperty.call(data, key)) return String(data[key]);
      return `[${key}]`;
  }
}

// Block-level (table/rich) data resolution.
function renderDataBlock(key, _replaceVars, ctx) {
  const { data = {} } = ctx;
  switch (key) {
    case 'line_items_table': {
      const items = Array.isArray(data.lineItems) ? data.lineItems : [];
      let html = '<table style="width:100%;border-collapse:collapse;font-size:inherit;margin:6px 0"><thead><tr>';
      ['#', 'Description', 'Qty', 'Unit Price', 'Amount'].forEach((h) => { html += `<th style="border:1px solid #ccc;padding:5px 8px;background:#f3f4f6;text-align:left">${h}</th>`; });
      html += '</tr></thead><tbody>';
      items.forEach((it, i) => {
        const amt = (it.amount != null && it.amount !== '') ? Number(it.amount) : Number(it.quantity || 0) * Number(it.unitPrice || 0);
        html += `<tr style="${i % 2 ? 'background:#f9fafb' : ''}"><td style="border:1px solid #ccc;padding:5px 8px">${i + 1}</td><td style="border:1px solid #ccc;padding:5px 8px">${esc(it.description || '')}</td><td style="border:1px solid #ccc;padding:5px 8px">${esc(String(it.quantity ?? ''))}</td><td style="border:1px solid #ccc;padding:5px 8px">${esc(String(it.unitPrice ?? ''))}</td><td style="border:1px solid #ccc;padding:5px 8px">${amt}</td></tr>`;
      });
      const { total, currency } = lineItemsTotal(data);
      html += `<tr style="font-weight:700;background:#e5e7eb"><td colspan="4" style="border:1px solid #ccc;padding:5px 8px;text-align:right">Total</td><td style="border:1px solid #ccc;padding:5px 8px">${total} ${currency}</td></tr>`;
      return html + '</tbody></table>';
    }
    case 'signatures_block': {
      const sigs = Array.isArray(data.signatures) ? data.signatures : [];
      if (!sigs.length) return '<p style="color:#9ca3af;font-size:11px"><em>No signatures</em></p>';
      let html = '<div style="display:flex;gap:24px;flex-wrap:wrap;margin:8px 0">';
      sigs.forEach((sig) => {
        html += `<div style="text-align:center;min-width:160px"><div style="font-size:11px;font-weight:700;margin-bottom:6px">${esc(sig.name || 'Signature')}</div>`;
        if (sig.imageURL) html += `<img src="${embedLocalImage(sig.imageURL)}" style="max-width:160px;max-height:60px;display:block;margin:0 auto" />`;
        html += '<div style="border-bottom:1px solid #000;width:160px;margin:6px auto"></div></div>';
      });
      return html + '</div>';
    }
    case 'total_price': { const { total, currency } = lineItemsTotal(data); return `<p style="margin:4px 0"><strong>Total:</strong> ${total} ${currency}</p>`; }
    case 'total_price_words': { const { total, currency } = lineItemsTotal(data); return `<p style="margin:4px 0;font-style:italic">${numberToWordsWithCurrency(total, currency)}</p>`; }
    default: return `<span>${esc(getInlineValue(key, ctx))}</span>`;
  }
}

const TABLE_VAR_KEYS = new Set(['line_items_table', 'signatures_block']);

// Replace <span data-var="key">label</span> chips (from the editor) with values.
function resolveInlineVars(html, ctx) {
  if (!html) return html;
  return html.replace(/<span([^>]*)data-var="([^"]+)"([^>]*)>.*?<\/span>/gis, (_, pre, key, post) => {
    if (TABLE_VAR_KEYS.has(key)) return renderDataBlock(key, (t) => t, ctx);
    let value = esc(getInlineValue(key, ctx));
    const allAttrs = (pre || '') + (post || '');
    const styleMatch = allAttrs.match(/style="([^"]*)"/i);
    const styleStr = styleMatch ? styleMatch[1] : '';
    const sizeMatch = styleStr.match(/font-size:\s*([^;]+)/);
    if (sizeMatch) value = `<span style="font-size:${sizeMatch[1]}">${value}</span>`;
    if (styleStr.includes('text-decoration:underline')) value = `<u>${value}</u>`;
    if (styleStr.includes('font-style:italic')) value = `<em>${value}</em>`;
    if (styleStr.includes('font-weight:bold')) value = `<strong>${value}</strong>`;
    return value;
  });
}

function toBulletPrefix(style, idx) {
  if (style === 'num') return `${idx + 1}.`;
  if (style === 'alpha') return `${String.fromCharCode(97 + idx)}.`;
  if (style === 'roman') {
    const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const syms = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
    let n = idx + 1, r = '';
    for (let i = 0; i < vals.length; i++) { while (n >= vals[i]) { r += syms[i]; n -= vals[i]; } }
    return r + '.';
  }
  return style || '•';
}

function renderPageBlock(block, replaceVars, ctx) {
  const align = block.align || 'left';
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.level || 1, 1), 3);
      const defaultSizes = { 1: '22px', 2: '18px', 3: '15px' };
      const weights = { 1: '700', 2: '600', 3: '500' };
      const fontSize = block.fontSize ? `${block.fontSize}px` : defaultSizes[level];
      const content = replaceVars(resolveInlineVars(block.content || '', ctx));
      return `<div style="font-size:${fontSize};font-weight:${weights[level]};margin:10px 0 4px 0;line-height:1.3;text-align:${align}">${content}</div>`;
    }
    case 'paragraph': {
      const fontSize = block.fontSize ? `${block.fontSize}px` : '11px';
      const content = replaceVars(resolveInlineVars(block.content || '', ctx));
      return `<div style="font-size:${fontSize};line-height:1.7;margin:4px 0 8px 0;white-space:pre-wrap;text-align:${align}">${content}</div>`;
    }
    case 'divider':
      return '<hr style="border:none;border-top:1px solid #d1d5db;margin:14px 0">';
    case 'spacer':
      return `<div style="height:${block.height || 24}px"></div>`;
    case 'bullet': {
      const items = block.items || [];
      if (!items.length) return '';
      const style = block.bulletStyle || '•';
      const fontSize = block.fontSize ? `${block.fontSize}px` : '11px';
      const indents = block.indents || [];
      const startAt = block.startAt || 1;
      const subStyle1 = block.subStyle1 || 'alpha';
      const subStyle2 = block.subStyle2 || 'roman';
      const counters = [startAt - 1, 0, 0];
      const prefixes = items.map((_, idx) => {
        const level = Math.min(indents[idx] || 0, 2);
        counters[level]++;
        for (let l = level + 1; l <= 2; l++) counters[l] = 0;
        const i = counters[level] - 1;
        if (level === 0) return toBulletPrefix(style, i);
        if (level === 1) return toBulletPrefix(subStyle1, i);
        return toBulletPrefix(subStyle2, i);
      });
      const rows = items.map((item, idx) => {
        const prefix = prefixes[idx];
        const rawHtml = typeof item === 'string' ? item : esc(item);
        const html = resolveInlineVars(rawHtml, ctx);
        const pl = (indents[idx] || 0) * 20;
        const prefixBold = /^\s*<(b|strong)[\s>]/i.test(rawHtml);
        const prefixStyle = `flex-shrink:0;color:#374151${prefixBold ? ';font-weight:bold' : ''}`;
        return `<div style="display:flex;gap:6px;margin:2px 0;font-size:${fontSize};line-height:1.6;padding-left:${pl}px"><span style="${prefixStyle}">${esc(prefix)}</span><span style="text-align:${align};flex:1">${html}</span></div>`;
      }).join('');
      return `<div style="margin:4px 0 10px 0">${rows}</div>`;
    }
    case 'image': {
      const src = embedLocalImage(block.src || '');
      if (!src) return '';
      const width = block.width || 200;
      return `<div style="text-align:${align};margin:8px 0"><img src="${src}" style="max-width:${width}px;max-height:300px;display:inline-block" /></div>`;
    }
    case 'sig_embedded': {
      const url = embedLocalImage(block.sigUrl || '');
      if (!url) return '';
      const showLine = block.showLine !== false;
      const lineWidth = block.lineWidth || 250;
      const sigHeight = block.sigHeight || 60;
      let html = `<div style="text-align:${align};margin:8px 0"><div style="display:inline-block;width:${lineWidth}px">`;
      html += `<img src="${url}" style="max-height:${sigHeight}px;max-width:100%;display:block;margin:0 auto" />`;
      if (showLine) html += `<div style="border-bottom:1px solid #374151;width:100%;margin-top:3px"></div>`;
      return html + '</div></div>';
    }
    case 'sig_placeholder': {
      const rows = block.rows?.length ? block.rows : [{ label: block.label || 'Signature' }, ...(block.showDate !== false ? [{ label: 'Date' }] : [])];
      let inner = '';
      rows.forEach((row, idx) => {
        const lbl = esc(row.label || (idx === 0 ? 'Signature' : idx === 1 ? 'Date' : ''));
        const lineStyle = idx === 0 ? 'border-bottom:1px dotted #666;height:48px;width:180px;display:block' : 'border-bottom:1px solid #aaa;height:32px;width:140px;display:block';
        inner += `<div style="margin-bottom:${idx < rows.length - 1 ? '12px' : '0'}"><div style="${lineStyle}"></div><p style="font-size:10px;color:#374151;margin:3px 0;font-weight:600">${lbl}</p></div>`;
      });
      return `<div style="text-align:${align};margin:12px 0"><div style="display:inline-block;min-width:180px">${inner}</div></div>`;
    }
    case 'columns': {
      const cols = block.cols || [];
      if (!cols.length) return '';
      const pct = Math.floor(100 / (block.colCount || cols.length));
      const tds = cols.map((col) => {
        const colType = col.type || 'text';
        const cellAlign = col.align || 'left';
        let cellHtml = '';
        if (colType === 'text') {
          cellHtml = `<div style="font-size:11px;line-height:1.7;text-align:${cellAlign}">${replaceVars(resolveInlineVars(col.content || '', ctx))}</div>`;
        } else if (colType === 'data') {
          const dataHtml = renderDataBlock(col.dataKey, replaceVars, ctx);
          const parts = [];
          if (col.fontWeight === 'bold') parts.push('font-weight:bold');
          if (col.fontStyle === 'italic') parts.push('font-style:italic');
          if (col.textDecoration === 'underline') parts.push('text-decoration:underline');
          if (col.fontSize) parts.push(`font-size:${col.fontSize}px`);
          if (col.width) parts.push(`width:${typeof col.width === 'number' ? `${col.width}px` : String(col.width)}`);
          cellHtml = parts.length ? `<div style="${parts.join(';')}">${dataHtml}</div>` : dataHtml;
        } else if (colType === 'sig_placeholder') {
          const rows = col.rows?.length ? col.rows : [{ label: col.label || 'Signature' }, { label: 'Date' }];
          let inner = '';
          rows.forEach((row, idx) => {
            const lbl = esc(row.label || (idx === 0 ? 'Signature' : idx === 1 ? 'Date' : ''));
            const lineStyle = idx === 0 ? 'border-bottom:1px dotted #666;height:40px;width:130px;display:block' : 'border-bottom:1px solid #aaa;height:28px;width:100px;display:block';
            inner += `<div style="margin-bottom:${idx < rows.length - 1 ? '10px' : '0'}"><div style="${lineStyle}"></div><p style="font-size:10px;color:#374151;margin:2px 0;font-weight:600">${lbl}</p></div>`;
          });
          cellHtml = `<div style="text-align:${cellAlign}"><div style="display:inline-block;min-width:130px">${inner}</div></div>`;
        } else if (colType === 'sig_embedded') {
          const sigSrc = embedLocalImage(col.sigUrl || '');
          if (sigSrc) {
            const showLine = col.showLine !== false;
            const lineWidth = col.lineWidth || 250;
            const sigHeight = col.sigHeight || 50;
            const linePart = showLine ? `<div style="border-bottom:1px solid #374151;width:100%;margin-top:3px"></div>` : '';
            cellHtml = `<div style="text-align:${cellAlign}"><div style="display:inline-block;width:${lineWidth}px"><img src="${sigSrc}" style="max-height:${sigHeight}px;max-width:100%;display:block;margin:0 auto" />${linePart}</div></div>`;
          }
        } else if (colType === 'image') {
          const s = embedLocalImage(col.src || '');
          if (s) cellHtml = `<div style="text-align:${cellAlign}"><img src="${s}" style="max-width:${col.width || 150}px;max-height:200px;display:inline-block" /></div>`;
        }
        const tdWidth = col.width ? (typeof col.width === 'number' ? `${col.width}px` : String(col.width)) : `${pct}%`;
        return `<td style="width:${tdWidth};padding:0 8px;vertical-align:top;border:none">${cellHtml}</td>`;
      }).join('');
      return `<table style="width:100%;border-collapse:collapse;border:none;margin:6px 0"><tr>${tds}</tr></table>`;
    }
    case 'data': {
      const dataHtml = renderDataBlock(block.dataKey, replaceVars, ctx);
      const parts = [];
      if (block.fontWeight === 'bold') parts.push('font-weight:bold');
      if (block.fontStyle === 'italic') parts.push('font-style:italic');
      if (block.textDecoration === 'underline') parts.push('text-decoration:underline');
      if (block.fontSize) parts.push(`font-size:${block.fontSize}px`);
      if (block.align && block.align !== 'left') parts.push(`text-align:${block.align}`);
      if (block.width) parts.push(`width:${typeof block.width === 'number' ? `${block.width}px` : String(block.width)}`);
      return parts.length ? `<div style="${parts.join(';')}">${dataHtml}</div>` : dataHtml;
    }
    default:
      return '';
  }
}

// Render a page/block template (+ Arixy context) into a PDF Buffer.
async function renderPageTemplateToPdf(context, templateData) {
  const pages = templateData.pages || [];
  const replaceVars = buildReplaceVariables(context);

  let bodyHtml = '';
  pages.forEach((page, idx) => {
    const pageBreak = idx > 0 ? 'page-break-before:always;' : '';
    bodyHtml += `<div style="${pageBreak}min-height:252mm;display:flex;flex-direction:column;">`;
    (page.blocks || []).forEach((block) => { bodyHtml += renderPageBlock(block, replaceVars, context); });
    bodyHtml += '</div>';
  });

  const css = `
    ${getArabicFontFaceCss()}
    * { box-sizing: border-box; }
    body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; margin: 0; padding: 0; color: #111827; font-size: 11px; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; font-size: inherit; }
    th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; font-size: inherit; }
    th { background: #f3f4f6; font-weight: 700; }
    a { color: #1d4ed8; text-decoration: underline; }
    strong { font-weight: 700; } em { font-style: italic; } u { text-decoration: underline; }
    .arabic { font-family: 'Amiri','Arial',sans-serif; direction: rtl; unicode-bidi: bidi-override; }
    .latin { direction: ltr; }
  `;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${bodyHtml}</body></html>`;
  const footerTemplate = `<div style="font-size:8px;color:#9ca3af;width:100%;text-align:right;padding-right:15mm;font-family:sans-serif">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

  return htmlToPdfBuffer(html, {
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:0;height:0;margin:0;padding:0;"></div>',
    footerTemplate,
    margin: { top: '20mm', right: '15mm', bottom: '25mm', left: '15mm' },
  });
}

module.exports = { renderTemplateToPdfBuffer, renderPageTemplateToPdf, buildHtml, buildReplaceVariables };
