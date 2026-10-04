// Branded PDF renderer for client reports built in the dashboard editor
// (models/ClientReport.js, source 'editor').
//
// Same toolkit and visual language as the monthly server report
// (utils/serverReportPdf.js): @react-pdf/renderer so it runs on Vercel, a
// full-bleed brand hero on page 1, a slim running header on later pages and a
// "Page X of Y" footer. The body is the report's content blocks in order;
// level-1 headings are numbered sections.

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
const { parseInline } = require('./richText');

const PAGE_W = 595.28;
const PAD_X = 44;
const HEADER_H = 50;
const FOOTER_H = 44;
const CONTENT_W = PAGE_W - PAD_X * 2;

const TONES = {
    info: { color: '#2563EB', bg: '#EEF3FE', label: 'Note' },
    success: { color: '#059669', bg: '#E8F7F1', label: 'Good news' },
    warning: { color: '#B45309', bg: '#FEF4E6', label: 'Heads up' },
    danger: { color: '#DC2626', bg: '#FDEDED', label: 'Important' },
};

const STAT_TONES = {
    good: '#059669',
    warn: '#D97706',
    bad: '#DC2626',
};

const PRIORITY = {
    high: { label: 'High', color: '#DC2626', bg: '#FDEDED' },
    medium: { label: 'Medium', color: '#B45309', bg: '#FEF4E6' },
    low: { label: 'Low', color: '#475569', bg: '#EEF0F5' },
};

const IMAGE_WIDTH = { full: 1, wide: 0.8, medium: 0.6, small: 0.4 };

const RTL_STYLE = { direction: 'rtl', textAlign: 'right' };
const rtl = (text) => (isRtl(text) ? RTL_STYLE : null);

// Content images: a large JPEG rendition (transparent areas on white) so
// screenshots stay sharp without bloating the PDF.
function contentImageUrl(url) {
    const m = String(url).match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)([^?#]*)/i);
    if (!m) return url;
    const rest = m[2].replace(/\.[a-z0-9]{2,5}$/i, '.jpg');
    return `${m[1]}b_white,f_jpg,q_85,w_1600,c_limit/${/\.jpg$/i.test(rest) ? rest : `${rest}.jpg`}`;
}

function reportFilename(report, company) {
    const title = safeFilePart(report.title) || 'Report';
    const who = safeFilePart(company?.name);
    return `${title}${who ? `-${who}` : ''}.pdf`;
}

function buildDocument(lib, { report, company, branding, brandLogo, clientLogo, images }) {
    const { React, Document, Page, View, Text, Image, Link, Svg, Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Path } = lib;
    const h = React.createElement;

    const accent = normalizeHex(branding.accentColor);
    const brandName = branding.brandName || 'Arixy Tech';
    const companyName = company?.name || 'Client';
    const title = report.title || 'Report';
    const kicker = report.category || 'Report';
    const preparedBy = report.preparedBy || `${brandName} Team`;
    const dateLabel = fmtDate(report.reportDate || report.publishedAt || new Date());

    /* ─── rich text ───────────────────────────────────────────────────── */

    const rich = (html, style, key) => {
        const runs = parseInline(html);
        const plain = runs.map((r) => r.text).join('');
        if (!plain.trim()) return null;
        return h(Text, { key, style: [style, rtl(plain)] }, ...runs.map((r, i) => {
            const s = {};
            if (r.bold) { s.fontWeight = 700; s.color = C.ink; }
            const deco = [(r.underline || r.href) && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ');
            if (deco) s.textDecoration = deco;
            if (r.mark) s.backgroundColor = '#FFF0A6';
            if (r.href) return h(Link, { key: i, src: r.href, style: { ...s, color: accent } }, r.text);
            return h(Text, { key: i, style: s }, r.text);
        }));
    };

    const plain = (text, style, key) => (text ? h(Text, { key, style: [style, rtl(text)] }, text) : null);

    /* ─── running header + footer (as in the server report) ───────────── */

    const runningHeader = h(View, {
        fixed: true,
        style: {
            position: 'absolute', top: 0, left: PAD_X, right: PAD_X, height: HEADER_H,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            borderBottomWidth: 1, borderBottomColor: C.line,
        },
    },
    h(View, { style: { flexDirection: 'row', alignItems: 'center', maxWidth: CONTENT_W - 150 } },
        h(Image, { src: brandLogo, style: { width: 16, height: 16, objectFit: 'contain', marginRight: 7 } }),
        h(Text, { style: { fontSize: 8.5, fontWeight: 700, color: C.ink } }, brandName),
        h(Text, { style: { fontSize: 8.5, color: C.faint, marginHorizontal: 7 } }, '/'),
        h(Text, { maxLines: 1, style: { fontSize: 8.5, color: C.muted } }, title)),
    h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
        h(Text, { style: { fontSize: 8.5, color: C.text2, fontWeight: 500 } }, companyName),
        clientLogo ? h(Image, { src: clientLogo, style: { width: 44, height: 18, objectFit: 'contain', marginLeft: 9 } }) : null));

    const footer = h(View, {
        fixed: true,
        style: {
            position: 'absolute', bottom: 0, left: PAD_X, right: PAD_X, height: FOOTER_H,
            flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line,
        },
    },
    h(Text, { maxLines: 1, style: { fontSize: 7.5, color: C.muted, maxWidth: CONTENT_W - 80 } },
        `${brandName}  ·  ${title}  ·  ${companyName}  ·  ${dateLabel}`));

    // No lineHeight here — react-pdf drops dynamic text that has one.
    const pageCounter = h(Text, {
        fixed: true,
        style: {
            position: 'absolute', bottom: FOOTER_H / 2 - 5, right: PAD_X, width: 80,
            textAlign: 'right', fontSize: 7.5, color: C.text2, fontWeight: 700,
        },
        render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`,
    });

    /* ─── hero (page 1) ───────────────────────────────────────────────── */

    const metaCell = (lbl, value) => h(View, { style: { flex: 1, paddingRight: 10 } },
        h(Text, { style: { fontSize: 6.8, letterSpacing: 1.1, color: C.heroLabel, fontWeight: 700, marginBottom: 4 } }, lbl.toUpperCase()),
        h(Text, { style: [{ fontSize: 9.5, color: C.white, fontWeight: 500 }, rtl(value)] }, value));

    const clientTile = clientLogo
        ? h(View, { style: { width: 128, height: 58, backgroundColor: C.white, borderRadius: 10, padding: 9, alignItems: 'center', justifyContent: 'center' } },
            h(Image, { src: clientLogo, style: { width: 110, height: 40, objectFit: 'contain' } }))
        : h(View, { style: { width: 58, height: 58, backgroundColor: accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } },
            h(Text, { style: { fontSize: 20, fontWeight: 700, color: C.white } }, initials(companyName)));

    const glow = (id, size, color, opacity, pos) => h(Svg, { width: size, height: size, style: { position: 'absolute', ...pos } },
        h(Defs, null,
            h(RadialGradient, { id, cx: '50%', cy: '50%', r: '50%' },
                h(Stop, { offset: '0%', stopColor: color, stopOpacity: opacity }),
                h(Stop, { offset: '100%', stopColor: color, stopOpacity: 0 }))),
        h(Circle, { cx: size / 2, cy: size / 2, r: size / 2, fill: `url(#${id})` }));

    const hero = h(View, {
        style: { marginTop: -(HEADER_H + 20), marginHorizontal: -PAD_X, backgroundColor: C.ink, position: 'relative', overflow: 'hidden' },
    },
    glow('glowViolet', 360, '#8B5CF6', 0.55, { top: -120, right: -90 }),
    glow('glowCyan', 260, '#22D3EE', 0.22, { top: 110, right: 150 }),
    h(View, { style: { paddingTop: 34, paddingHorizontal: PAD_X } },
        h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } },
            h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
                h(Image, { src: brandLogo, style: { width: 34, height: 34, objectFit: 'contain', marginRight: 10 } }),
                h(View, null,
                    h(Text, { style: { fontSize: 13, fontWeight: 700, color: C.white, letterSpacing: 0.3 } }, brandName),
                    branding.website ? h(Text, { style: { fontSize: 8, color: C.heroMuted, marginTop: 1 } }, branding.website) : null)),
            clientTile),

        h(Text, { style: { marginTop: 44, fontSize: 8.5, letterSpacing: 2.2, color: C.cyan, fontWeight: 700 } }, kicker.toUpperCase()),
        h(Text, { style: [{ marginTop: 8, fontSize: 28, lineHeight: 1.15, fontWeight: 700, color: C.white }, rtl(title)] }, title),
        report.subtitle
            ? h(Text, { style: [{ marginTop: 8, fontSize: 11.5, lineHeight: 1.45, color: C.heroMuted }, rtl(report.subtitle)] }, report.subtitle)
            : null,
        h(Text, { style: { marginTop: 10, fontSize: 12, color: C.heroMuted } },
            'Prepared for ',
            h(Text, { style: { color: C.white, fontWeight: 700 } }, companyName)),

        h(View, {
            style: { marginTop: 28, paddingVertical: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', flexDirection: 'row' },
        },
        metaCell('Date', dateLabel),
        metaCell('Prepared by', preparedBy),
        metaCell('Prepared for', companyName))),

    h(Svg, { width: PAGE_W, height: 5 },
        h(Defs, null,
            h(LinearGradient, { id: 'stripe', x1: '0', y1: '0', x2: '1', y2: '0' },
                ...BRAND_STRIPE.map((c, i) => h(Stop, { key: c, offset: `${(i / (BRAND_STRIPE.length - 1)) * 100}%`, stopColor: c })))),
        h(Rect, { x: 0, y: 0, width: PAGE_W, height: 5, fill: 'url(#stripe)' })));

    /* ─── blocks ──────────────────────────────────────────────────────── */

    const body = { fontSize: 10.2, lineHeight: 1.62, color: C.text2 };
    let sectionNo = 0;

    const renderers = {
        heading: (b, key, first) => {
            if (b.level === 2) {
                return h(View, { key, minPresenceAhead: 50, style: { marginTop: first ? 20 : 18, marginBottom: 6 } },
                    plain(b.text, { fontSize: 12.5, lineHeight: 1.3, fontWeight: 700, color: C.ink }));
            }
            sectionNo += 1;
            return h(View, { key, minPresenceAhead: 80, style: { marginTop: first ? 26 : 30, marginBottom: 12 } },
                h(View, { style: { flexDirection: 'row', alignItems: 'flex-end' } },
                    h(Text, { style: { fontSize: 9, lineHeight: 1.2, fontWeight: 700, color: accent, letterSpacing: 1, marginRight: 8, marginBottom: 1.5 } }, String(sectionNo).padStart(2, '0')),
                    h(Text, { style: [{ flex: 1, fontSize: 15, lineHeight: 1.25, fontWeight: 700, color: C.ink }, rtl(b.text)] }, b.text)),
                h(View, { style: { marginTop: 8, height: 1, backgroundColor: C.line } },
                    h(View, { style: { width: 28, height: 2, marginTop: -0.5, backgroundColor: accent } })));
        },

        paragraph: (b, key) => {
            const t = rich(b.html, { ...body, textAlign: b.align === 'center' ? 'center' : 'left' });
            return t ? h(View, { key, style: { marginTop: 4, marginBottom: 6 } }, t) : null;
        },

        list: (b, key) => {
            const items = (b.items || []).filter((it) => parseInline(it).some((r) => r.text.trim()));
            if (!items.length) return null;
            const marker = (i) => {
                if (b.style === 'number') {
                    return h(Text, { style: { width: 20, fontSize: 9.5, lineHeight: 1.62, fontWeight: 700, color: accent } }, `${i + 1}.`);
                }
                if (b.style === 'check') {
                    return h(View, { style: { width: 20, paddingTop: 3 } },
                        // Drawn: the brand fonts have no check-mark glyph.
                        h(Svg, { width: 10, height: 10 },
                            h(Rect, { x: 0, y: 0, width: 10, height: 10, rx: 2.5, ry: 2.5, fill: accent }),
                            h(Path, { d: 'M2.6 5.2 L4.4 7 L7.6 3.4', stroke: C.white, strokeWidth: 1.4, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' })));
                }
                return h(View, { style: { width: 20, paddingTop: 6 } },
                    h(View, { style: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: accent } }));
            };
            return h(View, { key, style: { marginTop: 4, marginBottom: 6 } },
                ...items.map((it, i) => h(View, { key: i, wrap: false, style: { flexDirection: 'row', marginTop: i ? 5 : 0 } },
                    marker(i),
                    h(View, { style: { flex: 1 } }, rich(it, body)))));
        },

        callout: (b, key) => {
            const tone = TONES[b.tone] || TONES.info;
            const text = rich(b.html, { fontSize: 10, lineHeight: 1.6, color: C.text2 });
            if (!text && !b.title) return null;
            return h(View, { key, wrap: false, style: { flexDirection: 'row', backgroundColor: tone.bg, borderRadius: 8, marginTop: 8, marginBottom: 8 } },
                h(View, { style: { width: 3, backgroundColor: tone.color, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 } }),
                h(View, { style: { flex: 1, paddingVertical: 13, paddingHorizontal: 16 } },
                    h(Text, { style: [{ fontSize: 9.5, lineHeight: 1.3, fontWeight: 700, color: tone.color, marginBottom: text ? 5 : 0 }, rtl(b.title)] }, b.title || tone.label),
                    text));
        },

        stats: (b, key) => {
            const items = (b.items || []).filter((s) => s.label || s.value);
            if (!items.length) return null;
            const rows = [];
            for (let i = 0; i < items.length; i += 4) rows.push(items.slice(i, i + 4));
            return h(View, { key, style: { marginTop: 8, marginBottom: 8 } },
                ...rows.map((row, ri) => h(View, { key: ri, wrap: false, style: { flexDirection: 'row', marginTop: ri ? 10 : 0 } },
                    ...row.map((s, i) => h(View, {
                        key: i,
                        style: { flex: 1, marginLeft: i ? 10 : 0, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.soft },
                    },
                    h(View, { style: { width: 18, height: 3, borderRadius: 2, backgroundColor: STAT_TONES[s.tone] || accent, marginBottom: 9 } }),
                    h(Text, { maxLines: 2, style: [{ fontSize: 7, lineHeight: 1.3, letterSpacing: 0.9, color: C.muted, fontWeight: 700 }, rtl(s.label)] }, String(s.label || '').toUpperCase()),
                    h(Text, { style: [{ fontSize: row.length > 3 ? 16 : 19, lineHeight: 1.15, fontWeight: 700, color: STAT_TONES[s.tone] || C.ink, marginTop: 6 }, rtl(s.value)] }, s.value || '—'),
                    s.note ? h(Text, { style: [{ fontSize: 7.5, lineHeight: 1.4, color: C.muted, marginTop: 5 }, rtl(s.note)] }, s.note) : null)))));
        },

        table: (b, key) => {
            const rows = (b.rows || []).filter((r) => r.some((c) => String(c || '').trim()));
            if (!rows.length) return null;
            const cols = Math.max(...rows.map((r) => r.length));
            const [head, ...rest] = b.header ? rows : [null, ...rows];
            const cell = (text, i, style, isHead = false) => h(View, { key: i, style: { width: `${100 / cols}%`, paddingRight: i < cols - 1 ? 10 : 0 } },
                h(Text, { style: [style, rtl(text)] }, text || (isHead ? ' ' : '—')));
            const headStyle = { fontSize: 7.2, lineHeight: 1.3, letterSpacing: 0.8, fontWeight: 700, color: C.white };
            const cellStyle = { fontSize: 8.8, lineHeight: 1.45, color: C.text2 };
            return h(View, { key, style: { marginTop: 8, marginBottom: 8, borderWidth: 1, borderColor: C.line, borderRadius: 10 } },
                head ? h(View, {
                    fixed: true,
                    minPresenceAhead: 40,
                    style: { flexDirection: 'row', backgroundColor: C.ink, borderTopLeftRadius: 9, borderTopRightRadius: 9, paddingVertical: 8, paddingHorizontal: 12 },
                }, ...Array.from({ length: cols }, (_, i) => cell(String(head[i] || '').toUpperCase(), i, headStyle, true))) : null,
                ...rest.map((r, ri) => h(View, {
                    key: ri,
                    wrap: false,
                    style: {
                        flexDirection: 'row',
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        backgroundColor: ri % 2 ? C.zebra : C.white,
                        borderTopWidth: ri || head ? 1 : 0,
                        borderTopColor: C.line,
                        borderTopLeftRadius: !head && ri === 0 ? 9 : 0,
                        borderTopRightRadius: !head && ri === 0 ? 9 : 0,
                        borderBottomLeftRadius: ri === rest.length - 1 ? 9 : 0,
                        borderBottomRightRadius: ri === rest.length - 1 ? 9 : 0,
                    },
                }, ...Array.from({ length: cols }, (_, i) => cell(String(r[i] || ''), i, i === 0 ? { ...cellStyle, fontWeight: 700, color: C.ink } : cellStyle)))));
        },

        image: (b, key) => {
            const img = images.get(b.url);
            const width = CONTENT_W * (IMAGE_WIDTH[b.size] || 1);
            const caption = b.caption ? h(Text, { style: [{ fontSize: 8, lineHeight: 1.4, color: C.muted, marginTop: 6, textAlign: 'center' }, rtl(b.caption)] }, b.caption) : null;
            if (!img) {
                if (!b.url) return null;
                return h(View, { key, wrap: false, style: { marginTop: 10, marginBottom: 10, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.soft } },
                    h(Text, { style: { fontSize: 8.5, color: C.muted, textAlign: 'center' } }, 'Image could not be loaded'),
                    caption);
            }
            return h(View, { key, wrap: false, style: { marginTop: 10, marginBottom: 10, alignItems: 'center' } },
                h(View, { style: { width, borderRadius: 8, borderWidth: 1, borderColor: C.line, overflow: 'hidden' } },
                    h(Image, { src: img, style: { width: '100%' } })),
                caption ? h(View, { style: { width } }, caption) : null);
        },

        quote: (b, key) => {
            const text = rich(b.html, { fontSize: 12, lineHeight: 1.55, color: C.ink, fontWeight: 500 });
            if (!text) return null;
            return h(View, { key, wrap: false, style: { flexDirection: 'row', marginTop: 12, marginBottom: 12 } },
                h(View, { style: { width: 3, borderRadius: 2, backgroundColor: accent } }),
                h(View, { style: { flex: 1, paddingLeft: 14, paddingVertical: 2 } },
                    text,
                    b.cite ? h(Text, { style: [{ fontSize: 8.5, color: C.muted, marginTop: 6, fontWeight: 500 }, rtl(b.cite)] }, `— ${b.cite}`) : null));
        },

        actions: (b, key) => {
            const items = (b.items || []).filter((a) => a.title);
            if (!items.length) return null;
            return h(View, { key, style: { marginTop: 8, marginBottom: 8 } },
                ...items.map((a, i) => {
                    const p = PRIORITY[a.priority] || PRIORITY.medium;
                    return h(View, {
                        key: i,
                        wrap: false,
                        style: { flexDirection: 'row', marginTop: i ? 8 : 0, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.white },
                    },
                    h(View, { style: { width: 62 } },
                        h(View, { style: { alignSelf: 'flex-start', backgroundColor: p.bg, borderRadius: 10, paddingVertical: 3.5, paddingHorizontal: 8 } },
                            h(Text, { style: { fontSize: 7.2, lineHeight: 1, fontWeight: 700, color: p.color } }, p.label.toUpperCase()))),
                    h(View, { style: { flex: 1, paddingRight: 10 } },
                        h(Text, { style: [{ fontSize: 10, lineHeight: 1.35, fontWeight: 700, color: C.ink }, rtl(a.title)] }, a.title),
                        a.detail ? h(Text, { style: [{ fontSize: 8.8, lineHeight: 1.5, color: C.text2, marginTop: 3 }, rtl(a.detail)] }, a.detail) : null),
                    a.owner ? h(View, { style: { width: 110, alignItems: 'flex-end' } },
                        h(Text, { style: { fontSize: 6.8, letterSpacing: 0.9, color: C.muted, fontWeight: 700 } }, 'OWNER'),
                        h(Text, { style: [{ fontSize: 9, lineHeight: 1.3, color: C.ink, fontWeight: 500, marginTop: 2, textAlign: 'right' }, rtl(a.owner)] }, a.owner)) : null);
                }));
        },

        divider: (_b, key) => h(View, { key, style: { height: 1, backgroundColor: C.line, marginTop: 14, marginBottom: 14 } }),

        pageBreak: (_b, key) => h(View, { key, break: true }),
    };

    const blocks = (report.blocks || []).map((b, i) => {
        const fn = renderers[b?.type];
        return fn ? fn(b, `b${i}`, i === 0) : null;
    }).filter(Boolean);

    if (!blocks.length) {
        blocks.push(h(Text, { key: 'empty', style: { marginTop: 28, fontSize: 10, color: C.muted } }, 'No content has been added to this report yet.'));
    }

    /* ─── sign-off ────────────────────────────────────────────────────── */

    const contactLines = [
        [branding.email, branding.phone].filter(Boolean).join('  ·  '),
        branding.website,
    ].filter(Boolean);
    const signOff = h(View, {
        wrap: false,
        style: { marginTop: 32, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line, flexDirection: 'row', justifyContent: 'space-between' },
    },
    h(View, { style: { flexDirection: 'row', alignItems: 'center', width: '52%' } },
        h(Image, { src: brandLogo, style: { width: 26, height: 26, objectFit: 'contain', marginRight: 10 } }),
        h(View, { style: { flex: 1 } },
            h(Text, { style: { fontSize: 9.5, lineHeight: 1.3, fontWeight: 700, color: C.ink } }, `Prepared by ${preparedBy}`),
            ...contactLines.map((line, i) => h(Text, { key: i, style: { fontSize: 8, lineHeight: 1.35, color: C.muted, marginTop: i ? 0 : 2 } }, line)))),
    h(View, { style: { width: '44%', alignItems: 'flex-end' } },
        h(Text, { style: { fontSize: 9.5, lineHeight: 1.3, fontWeight: 700, color: C.ink } }, 'Questions about this report?'),
        h(Text, { style: { fontSize: 8, lineHeight: 1.35, color: C.muted, marginTop: 2, textAlign: 'right' } }, 'Reply to our email or open a ticket in your client portal.'),
        branding.portalUrl ? h(Link, { src: branding.portalUrl, style: { fontSize: 8, color: accent, marginTop: 4, textDecoration: 'none', fontWeight: 700 } }, 'Open client portal →') : null));

    return h(Document, {
        title: `${title} — ${companyName}`,
        author: brandName,
        subject: `${kicker} for ${companyName}`,
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
    h(View, { style: { height: 4 } }),
    ...blocks,
    signOff,
    footer,
    pageCounter));
}

/**
 * Render an editor report to a PDF Buffer.
 * @param {object} args
 * @param {object} args.report   plain ClientReport-shaped object (saved or unsaved)
 * @param {object} args.company  { name, logo }
 * @param {object} args.branding ReportSettings-shaped object
 */
async function renderClientReportPdf({ report, company, branding = {} }) {
    const lib = await loadLib();
    const urls = [...new Set((report.blocks || []).filter((b) => b?.type === 'image' && b.url).map((b) => b.url))];
    const [brandLogo, clientLogo, ...fetched] = await Promise.all([
        loadBrandLogo(branding),
        fetchImage(company?.logo),
        ...urls.map((u) => fetchImage(u, contentImageUrl)),
    ]);
    const images = new Map(urls.map((u, i) => [u, fetched[i]]));
    const doc = buildDocument(lib, { report, company, branding, brandLogo, clientLogo, images });
    return lib.renderToBuffer(doc);
}

module.exports = { renderClientReportPdf, reportFilename };
