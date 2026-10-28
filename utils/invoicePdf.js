// Branded invoice PDF (models/Invoice.js).
//
// Same toolkit and visual language as the report PDFs (utils/serverReportPdf.js):
// @react-pdf/renderer so it runs on Vercel, the dark brand hero with the logo
// gradient stripe on page 1, a slim running header on later pages and a
// "Page X of Y" footer. Line items at 0 print as "Free".

const {
    loadLib,
    fetchImage,
    loadBrandLogo,
    normalizeHex,
    initials,
    isRtl,
    safeFilePart,
    fmtDate,
    C,
    BRAND_STRIPE,
} = require('./serverReportPdf');

const PAGE_W = 595.28;
const PAD_X = 44;
const HEADER_H = 50;
const FOOTER_H = 44;
const CONTENT_W = PAGE_W - PAD_X * 2;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const RTL_STYLE = { direction: 'rtl', textAlign: 'right' };
const rtl = (text) => (isRtl(text) ? RTL_STYLE : null);

const GREEN = '#059669';
const GREEN_BG = '#E7F7F1';

function fmtAmount(n) {
    const v = Number(n || 0);
    return v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}
const money = (n, currency) => `${fmtAmount(n)} ${currency || ''}`.trim();

// What the client sees as the invoice state; time-independent apart from
// "Overdue", which the dashboard only sets when it re-renders.
function invoiceState(invoice, amountPaid) {
    const total = Number(invoice.total || 0);
    if (invoice.status === 'void') return { key: 'void', label: 'Void', color: C.muted, bg: C.soft };
    if (total === 0) return { key: 'free', label: 'Free', color: GREEN, bg: GREEN_BG };
    if (amountPaid >= total) return { key: 'paid', label: 'Paid', color: GREEN, bg: GREEN_BG };
    if (amountPaid > 0) return { key: 'partial', label: 'Partially paid', color: '#B45309', bg: '#FEF3E2' };
    if (invoice.status === 'overdue') return { key: 'overdue', label: 'Overdue', color: '#DC2626', bg: '#FDECEC' };
    return { key: 'due', label: 'Payment due', color: '#2563EB', bg: '#E8F0FE' };
}

function invoiceFilename(invoice, company) {
    const num = safeFilePart(invoice.number) || 'Invoice';
    const who = safeFilePart(company?.name) || 'Client';
    return `Invoice-${num}-${who}.pdf`;
}

function buildDocument(lib, { invoice, company, branding, brandLogo, clientLogo, amountPaid }) {
    const { React, Document, Page, View, Text, Image, Svg, Defs, LinearGradient, RadialGradient, Stop, Rect, Circle } = lib;
    const h = React.createElement;

    const accent = normalizeHex(branding.accentColor);
    const brandName = branding.brandName || 'Arixy Tech';
    const companyName = company?.name || 'Client';
    const currency = invoice.currency || '';
    const number = invoice.number || 'Draft';
    const total = Number(invoice.total || 0);
    const tax = Number(invoice.tax || 0);
    const balance = Math.max(0, total - amountPaid);
    const state = invoiceState(invoice, amountPaid);
    const items = (invoice.lineItems || []).filter((li) => li && (li.name || li.description));
    const period = invoice.period?.month ? `${MONTHS[invoice.period.month - 1]} ${invoice.period.year}` : '';

    const runningHeader = h(View, {
        fixed: true,
        style: {
            position: 'absolute', top: 0, left: PAD_X, right: PAD_X, height: HEADER_H,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            borderBottomWidth: 1, borderBottomColor: C.line,
        },
    },
    h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
        h(Image, { src: brandLogo, style: { width: 16, height: 16, objectFit: 'contain', marginRight: 7 } }),
        h(Text, { style: { fontSize: 8.5, fontWeight: 700, color: C.ink } }, brandName),
        h(Text, { style: { fontSize: 8.5, color: C.faint, marginHorizontal: 7 } }, '/'),
        h(Text, { style: { fontSize: 8.5, color: C.muted } }, `Invoice ${number}`)),
    h(Text, { style: { fontSize: 8.5, color: C.text2, fontWeight: 500 } }, companyName));

    const footer = h(View, {
        fixed: true,
        style: {
            position: 'absolute', bottom: 0, left: PAD_X, right: PAD_X, height: FOOTER_H,
            flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line,
        },
    },
    h(Text, { style: { fontSize: 7.5, color: C.muted, maxWidth: CONTENT_W - 80 } },
        [brandName, `Invoice ${number}`, companyName, branding.website].filter(Boolean).join('  ·  ')));

    // No lineHeight here (or inherited) — react-pdf drops dynamic text that has one.
    const pageCounter = h(Text, {
        fixed: true,
        style: {
            position: 'absolute', bottom: FOOTER_H / 2 - 5, right: PAD_X, width: 80,
            textAlign: 'right', fontSize: 7.5, color: C.text2, fontWeight: 700,
        },
        render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`,
    });

    /* hero */
    const metaCell = (lbl, value) => h(View, { style: { flex: 1, paddingRight: 10 } },
        h(Text, { style: { fontSize: 6.8, letterSpacing: 1.1, color: C.heroLabel, fontWeight: 700, marginBottom: 4 } }, lbl.toUpperCase()),
        h(Text, { style: { fontSize: 9.5, color: C.white, fontWeight: 500 } }, value || '—'));

    const amountLabel = state.key === 'free' ? 'Free' : money(state.key === 'paid' ? total : balance, currency);
    const amountCaption = { free: 'Total', paid: 'Total paid', void: 'Amount' }[state.key] || 'Amount due';

    const hero = h(View, {
        // Clip the glows so they never bleed onto the white page below.
        style: { marginTop: -(HEADER_H + 20), marginHorizontal: -PAD_X, backgroundColor: C.ink, position: 'relative', overflow: 'hidden' },
    },
    h(Svg, { width: 360, height: 360, style: { position: 'absolute', top: -140, right: -100 } },
        h(Defs, null,
            h(RadialGradient, { id: 'glowViolet', cx: '50%', cy: '50%', r: '50%' },
                h(Stop, { offset: '0%', stopColor: '#8B5CF6', stopOpacity: 0.5 }),
                h(Stop, { offset: '100%', stopColor: '#8B5CF6', stopOpacity: 0 }))),
        h(Circle, { cx: 180, cy: 180, r: 180, fill: 'url(#glowViolet)' })),
    h(Svg, { width: 240, height: 240, style: { position: 'absolute', top: -20, right: 170 } },
        h(Defs, null,
            h(RadialGradient, { id: 'glowCyan', cx: '50%', cy: '50%', r: '50%' },
                h(Stop, { offset: '0%', stopColor: '#22D3EE', stopOpacity: 0.2 }),
                h(Stop, { offset: '100%', stopColor: '#22D3EE', stopOpacity: 0 }))),
        h(Circle, { cx: 120, cy: 120, r: 120, fill: 'url(#glowCyan)' })),

    h(View, { style: { paddingTop: 28, paddingHorizontal: PAD_X } },
        h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' } },
            h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
                h(Image, { src: brandLogo, style: { width: 34, height: 34, objectFit: 'contain', marginRight: 10 } }),
                h(View, null,
                    h(Text, { style: { fontSize: 13, fontWeight: 700, color: C.white, letterSpacing: 0.3 } }, brandName),
                    branding.website ? h(Text, { style: { fontSize: 8, color: C.heroMuted, marginTop: 1 } }, branding.website) : null)),
            h(View, { style: { alignItems: 'flex-end' } },
                h(Text, { style: { fontSize: 8.5, letterSpacing: 2.2, color: C.cyan, fontWeight: 700 } }, 'INVOICE'),
                h(Text, { style: { marginTop: 6, fontSize: 20, fontWeight: 700, color: C.white } }, number))),

        h(View, { style: { marginTop: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' } },
            h(View, { style: { flex: 1 } },
                h(Text, { style: { fontSize: 8.5, letterSpacing: 1.4, color: C.heroLabel, fontWeight: 700 } }, amountCaption.toUpperCase()),
                h(Text, { style: { marginTop: 6, fontSize: 30, lineHeight: 1.1, fontWeight: 700, color: C.white } }, amountLabel)),
            h(View, { style: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: state.bg } },
                h(Text, { style: { fontSize: 8.5, fontWeight: 700, color: state.color, letterSpacing: 0.6 } }, state.label.toUpperCase()))),

        h(View, {
            style: { marginTop: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', flexDirection: 'row' },
        },
        metaCell('Issued', fmtDate(invoice.issueDate || invoice.createdAt, { short: true })),
        metaCell('Due', invoice.dueDate ? fmtDate(invoice.dueDate, { short: true }) : (state.key === 'free' ? '—' : 'On receipt')),
        metaCell(period ? 'Period' : 'Type', period || (invoice.type === 'maintenance' ? 'Maintenance' : 'Project')),
        metaCell('Currency', currency))),

    h(Svg, { width: PAGE_W, height: 5 },
        h(Defs, null,
            h(LinearGradient, { id: 'stripe', x1: '0', y1: '0', x2: '1', y2: '0' },
                ...BRAND_STRIPE.map((c, i) => h(Stop, { key: c, offset: `${(i / (BRAND_STRIPE.length - 1)) * 100}%`, stopColor: c })))),
        h(Rect, { x: 0, y: 0, width: PAGE_W, height: 5, fill: 'url(#stripe)' })));

    /* parties */
    const partyLabel = (t) => h(Text, { style: { fontSize: 7, letterSpacing: 1.1, color: C.muted, fontWeight: 700, marginBottom: 7 } }, t.toUpperCase());
    const partyLine = (t, key) => (t ? h(Text, { key, style: [{ fontSize: 9, color: C.text2, marginTop: 2.5 }, rtl(t)] }, t) : null);

    const clientMark = clientLogo
        ? h(Image, { src: clientLogo, style: { width: 64, height: 26, objectFit: 'contain', marginBottom: 8 } })
        : h(View, { style: { width: 26, height: 26, borderRadius: 7, backgroundColor: accent, alignItems: 'center', justifyContent: 'center', marginBottom: 8 } },
            h(Text, { style: { fontSize: 10, fontWeight: 700, color: C.white } }, initials(companyName)));

    const parties = h(View, { wrap: false, style: { flexDirection: 'row', marginTop: 22 } },
        h(View, { style: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: C.soft, borderWidth: 1, borderColor: C.line, marginRight: 10 } },
            partyLabel('Billed to'),
            clientMark,
            h(Text, { style: [{ fontSize: 11, fontWeight: 700, color: C.ink }, rtl(companyName)] }, companyName),
            partyLine(company?.address, 'a'),
            partyLine(company?.contactEmail, 'e'),
            partyLine(company?.phone, 'p')),
        h(View, { style: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.line } },
            partyLabel('From'),
            h(Text, { style: { fontSize: 11, fontWeight: 700, color: C.ink } }, brandName),
            partyLine(branding.website, 'w'),
            partyLine(branding.email, 'e'),
            partyLine(branding.phone, 'p')));

    /* line items */
    const COL = { no: 26, qty: 44, price: 88, amount: 92 };
    const th = (t, style) => h(Text, { style: [{ fontSize: 7, letterSpacing: 1, color: C.muted, fontWeight: 700 }, style] }, t.toUpperCase());
    const freeTag = h(View, { style: { alignSelf: 'flex-end', paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 999, backgroundColor: GREEN_BG } },
        h(Text, { style: { fontSize: 8, fontWeight: 700, color: GREEN } }, 'Free'));

    const itemRows = items.map((li, i) => {
        const title = li.name || li.description;
        const detail = li.name ? li.description : '';
        const amount = Number(li.quantity || 0) * Number(li.unitPrice || 0);
        return h(View, {
            key: i,
            wrap: false,
            style: {
                flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 10,
                borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: i % 2 ? C.zebra : C.white,
            },
        },
        h(Text, { style: { width: COL.no, fontSize: 8.5, color: C.faint, fontWeight: 700, paddingTop: 1 } }, String(i + 1).padStart(2, '0')),
        h(View, { style: { flex: 1, paddingRight: 10 } },
            h(Text, { style: [{ fontSize: 10, fontWeight: 700, color: C.ink }, rtl(title)] }, title),
            detail ? h(Text, { style: [{ fontSize: 8.5, lineHeight: 1.5, color: C.text2, marginTop: 3 }, rtl(detail)] }, detail) : null),
        h(Text, { style: { width: COL.qty, fontSize: 9, color: C.text2, textAlign: 'right', paddingTop: 1 } }, fmtAmount(li.quantity)),
        h(Text, { style: { width: COL.price, fontSize: 9, color: C.text2, textAlign: 'right', paddingTop: 1 } },
            Number(li.unitPrice || 0) === 0 ? '—' : fmtAmount(li.unitPrice)),
        h(View, { style: { width: COL.amount, alignItems: 'flex-end' } },
            amount === 0 ? freeTag : h(Text, { style: { fontSize: 9.5, fontWeight: 700, color: C.ink, textAlign: 'right', paddingTop: 1 } }, fmtAmount(amount))));
    });

    const itemsTable = h(View, { style: { marginTop: 22 } },
        h(View, { style: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1.5, borderBottomColor: C.ink } },
            th('#', { width: COL.no }),
            th('Product / Service', { flex: 1 }),
            th('Qty', { width: COL.qty, textAlign: 'right' }),
            th('Unit price', { width: COL.price, textAlign: 'right' }),
            th(`Amount (${currency})`, { width: COL.amount, textAlign: 'right' })),
        ...itemRows,
        items.length === 0
            ? h(Text, { style: { padding: 14, fontSize: 9, color: C.muted } }, 'No items.')
            : null);

    /* totals */
    const totalRow = (lbl, value, { strong = false, color = C.text2 } = {}) => h(View, {
        style: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: strong ? 9 : 5 },
    },
    h(Text, { style: { fontSize: strong ? 10 : 9, color: strong ? C.ink : C.muted, fontWeight: strong ? 700 : 400 } }, lbl),
    h(Text, { style: { fontSize: strong ? 12 : 9.5, color: strong ? C.ink : color, fontWeight: strong ? 700 : 500 } }, value));

    const totalsBox = h(View, { style: { width: 230 } },
            totalRow('Subtotal', invoice.subtotal === 0 ? 'Free' : money(invoice.subtotal, currency)),
            tax !== 0 ? totalRow('Tax', money(tax, currency)) : null,
            h(View, { style: { borderTopWidth: 1.5, borderTopColor: C.ink, marginTop: 4 } },
                totalRow('Total', total === 0 ? 'Free' : money(total, currency), { strong: true })),
            amountPaid > 0 ? totalRow('Paid', `− ${money(amountPaid, currency)}`, { color: GREEN }) : null,
            total > 0 && state.key !== 'void'
                ? h(View, { style: { marginTop: 6, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8, backgroundColor: balance > 0 ? tintAccent(accent) : GREEN_BG, flexDirection: 'row', justifyContent: 'space-between' } },
                    h(Text, { style: { fontSize: 9.5, fontWeight: 700, color: balance > 0 ? accent : GREEN } }, balance > 0 ? 'Balance due' : 'Paid in full'),
                    h(Text, { style: { fontSize: 11, fontWeight: 700, color: balance > 0 ? accent : GREEN } }, money(balance, currency)))
                : null);

    /* notes + payment details: beside the totals when short, below otherwise */
    const block = (label, text, key, first) => h(View, { key, wrap: false, style: { marginTop: first ? 0 : 18 } },
        h(Text, { style: { fontSize: 7, letterSpacing: 1.1, color: C.muted, fontWeight: 700, marginBottom: 6 } }, label.toUpperCase()),
        h(View, { style: { borderLeftWidth: 2, borderLeftColor: accent, paddingLeft: 10 } },
            ...String(text).split(/\r?\n/).map((line, i) => h(Text, { key: i, style: [{ fontSize: 9, lineHeight: 1.55, color: C.text2 }, rtl(line)] }, line || ' '))));

    const extraTexts = [];
    if (invoice.notes) extraTexts.push(['Notes', invoice.notes]);
    if (branding.invoicePaymentDetails && balance > 0 && state.key !== 'void') {
        extraTexts.push(['How to pay', branding.invoicePaymentDetails]);
    }
    const besideTotals = extraTexts.reduce((t, [, text]) => t + text.length, 0) <= 600
        && extraTexts.every(([, text]) => text.split(/\r?\n/).length <= 8);
    const extras = extraTexts.map(([label, text], i) => block(label, text, label, besideTotals && i === 0));

    const totals = h(View, { wrap: false, style: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 } },
        besideTotals && extras.length ? h(View, { style: { flex: 1, paddingRight: 28, paddingTop: 6 } }, ...extras) : null,
        totalsBox);
    const below = besideTotals ? [] : extras;
    const closing = branding.invoiceNote
        ? h(Text, { style: [{ marginTop: 26, fontSize: 10, fontWeight: 700, color: C.ink }, rtl(branding.invoiceNote)] }, branding.invoiceNote)
        : null;

    return h(Document, {
        title: `Invoice ${number} — ${companyName}`,
        author: brandName,
        subject: `Invoice for ${companyName}`,
        creator: brandName,
        producer: brandName,
        language: 'en',
    },
    h(Page, {
        size: 'A4',
        style: {
            paddingTop: HEADER_H + 20,
            paddingBottom: FOOTER_H + 22,
            paddingHorizontal: PAD_X,
            fontFamily: ['SpaceGrotesk', 'PlexArabic'],
            fontSize: 9.5,
            color: C.text,
            backgroundColor: C.white,
        },
    },
    runningHeader,
    hero,
    parties,
    itemsTable,
    totals,
    ...below,
    closing,
    footer,
    pageCounter));
}

// Soft accent background for the balance-due pill.
function tintAccent(hex) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * 0.9);
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

async function renderInvoicePdf({ invoice, company, branding = {}, amountPaid = 0 }) {
    const lib = await loadLib();
    const [brandLogo, clientLogo] = await Promise.all([
        loadBrandLogo(branding),
        fetchImage(company?.logo),
    ]);
    const doc = buildDocument(lib, { invoice, company, branding, brandLogo, clientLogo, amountPaid: Number(amountPaid || 0) });
    return lib.renderToBuffer(doc);
}

module.exports = { renderInvoicePdf, invoiceFilename };
