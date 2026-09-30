// Branded PDF renderer for monthly server reports (models/ServerReport.js).
//
// Uses @react-pdf/renderer — pure JavaScript layout + PDF writer, no headless
// Chromium — so it runs on Vercel serverless where the puppeteer pipeline in
// utils/pdfBrowser.js cannot start. The backend has no JSX build step, so the
// document is built with React.createElement (aliased `h`).
//
// Layout: page 1 opens with a full-bleed brand hero (agency + client logos,
// period, meta row); every later page gets a slim running header; every page
// gets a footer with "Page X of Y". Sections with no content are skipped and
// the remaining ones are numbered in order.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'assets', 'arixy-logo.png');
const FONT = ['SpaceGrotesk', 'PlexArabic'];

/* ─── lazy module loading (react-pdf is ESM-only) ─────────────────────── */

let libPromise = null;
function loadLib() {
    if (!libPromise) {
        libPromise = (async () => {
            const React = require('react');
            // Literal specifier so Vercel's file tracer bundles the package.
            const pdf = await import('@react-pdf/renderer');
            const f = (name) => path.join(FONT_DIR, name);
            pdf.Font.register({
                family: 'SpaceGrotesk',
                fonts: [
                    { src: f('SpaceGrotesk-Regular.ttf'), fontWeight: 400 },
                    { src: f('SpaceGrotesk-Medium.ttf'), fontWeight: 500 },
                    { src: f('SpaceGrotesk-Bold.ttf'), fontWeight: 600 },
                    { src: f('SpaceGrotesk-Bold.ttf'), fontWeight: 700 },
                ],
            });
            // Glyph fallback for Arabic text (company names, notes).
            pdf.Font.register({
                family: 'PlexArabic',
                fonts: [
                    { src: f('IBMPlexSansArabic-Regular.ttf'), fontWeight: 400 },
                    { src: f('IBMPlexSansArabic-Regular.ttf'), fontWeight: 500 },
                    { src: f('IBMPlexSansArabic-Bold.ttf'), fontWeight: 600 },
                    { src: f('IBMPlexSansArabic-Bold.ttf'), fontWeight: 700 },
                ],
            });
            // No dictionary hyphenation (it splits ordinary words mid-line);
            // only break very long tokens such as URLs.
            pdf.Font.registerHyphenationCallback((word) => {
                if (word.length <= 28) return [word];
                const parts = [];
                for (let i = 0; i < word.length; i += 20) parts.push(word.slice(i, i + 20));
                return parts;
            });
            return { React, ...pdf };
        })().catch((err) => {
            libPromise = null;
            throw err;
        });
    }
    return libPromise;
}

/* ─── formatting helpers ──────────────────────────────────────────────── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

// Report dates are stored as UTC midnight, so always read them in UTC.
const toDate = (d) => (d ? new Date(d) : null);
const validDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

function fmtDate(d, { short = false } = {}) {
    const x = toDate(d);
    if (!validDate(x)) return '';
    const day = String(x.getUTCDate()).padStart(2, '0');
    const month = (short ? MONTHS_SHORT : MONTHS)[x.getUTCMonth()];
    return `${day} ${month} ${x.getUTCFullYear()}`;
}

// "September 2026" for a whole calendar month, otherwise an explicit range.
function periodLabel(start, end) {
    const s = toDate(start);
    const e = toDate(end);
    if (!validDate(s) || !validDate(e)) return '';
    const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
    const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth();
    const lastDay = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
    if (sameMonth && s.getUTCDate() === 1 && e.getUTCDate() === lastDay) {
        return `${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
    }
    if (sameMonth) return `${s.getUTCDate()} – ${e.getUTCDate()} ${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
    if (sameYear) return `${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS_SHORT[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
    return `${fmtDate(s, { short: true })} – ${fmtDate(e, { short: true })}`;
}

function periodRange(start, end) {
    const s = toDate(start);
    const e = toDate(end);
    if (!validDate(s) || !validDate(e)) return '';
    const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
    const from = sameYear
        ? `${String(s.getUTCDate()).padStart(2, '0')} ${MONTHS_SHORT[s.getUTCMonth()]}`
        : fmtDate(s, { short: true });
    return `${from} – ${fmtDate(e, { short: true })}`;
}

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

function fmtNum(v) {
    if (!isNum(v)) return '—';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN_RE = /[A-Za-z]/g;
const isRtl = (text) => {
    const s = String(text || '');
    return (s.match(ARABIC_RE) || []).length > (s.match(LATIN_RE) || []).length;
};
// Mostly-Arabic text gets an RTL base direction (so mixed Arabic/Latin runs
// are ordered correctly) and right alignment.
const RTL_STYLE = { direction: 'rtl', textAlign: 'right' };
const rtl = (text) => (isRtl(text) ? RTL_STYLE : null);

const paragraphs = (text) => String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

// Letters/digits of any script survive (Arabic company names); the HTTP layer
// adds an ASCII fallback for the Content-Disposition header.
function safeFilePart(s) {
    return String(s || '')
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60);
}

function reportFilename(report, company) {
    const s = toDate(report.periodStart);
    const ym = validDate(s) ? `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}` : 'report';
    const who = safeFilePart(company?.name) || 'Client';
    return `Server-Report-${who}-${ym}.pdf`;
}

/* ─── colours ─────────────────────────────────────────────────────────── */

const C = {
    ink: '#0E0B1F',
    text: '#1F2335',
    text2: '#454A61',
    muted: '#7A7F96',
    faint: '#A5A9BC',
    line: '#E7E8F0',
    soft: '#F7F7FB',
    zebra: '#FAFAFD',
    white: '#FFFFFF',
    heroMuted: '#A9A5CC',
    heroLabel: '#8C88B3',
    cyan: '#7EF0EA',
};

// Arixy logo gradient, used for the stripe under the hero.
const BRAND_STRIPE = ['#4C1D95', '#B517F5', '#F9A8C9', '#7AF2D0', '#5FD3F3'];

// `onDark` is the brighter tone used on the dark hero.
const STATUS = {
    operational: { label: 'Operational', color: '#059669', bg: '#E7F7F1', onDark: '#34D399' },
    degraded: { label: 'Degraded', color: '#B45309', bg: '#FEF3E2', onDark: '#FBBF24' },
    down: { label: 'Down', color: '#DC2626', bg: '#FDECEC', onDark: '#F87171' },
    maintenance: { label: 'Maintenance', color: '#2563EB', bg: '#E8F0FE', onDark: '#60A5FA' },
};
const STATUS_ORDER = ['operational', 'degraded', 'maintenance', 'down'];

const DEFAULT_ACCENT = '#4F46E5';
const normalizeHex = (hex) => (/^#[0-9a-f]{6}$/i.test(String(hex || '').trim()) ? String(hex).trim() : DEFAULT_ACCENT);

// Blend a hex colour towards white (amount 0 → colour, 1 → white).
function tint(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/* ─── summaries shared with the email + portal ────────────────────────── */

function serviceSummary(services = []) {
    const counts = { operational: 0, degraded: 0, down: 0, maintenance: 0 };
    services.forEach((s) => { counts[STATUS[s.status] ? s.status : 'operational'] += 1; });
    const total = services.length;
    let overall = null;
    if (total) {
        if (counts.down) overall = { key: 'down', label: 'Service disruption' };
        else if (counts.degraded) overall = { key: 'degraded', label: 'Partially degraded' };
        else if (counts.maintenance) overall = { key: 'maintenance', label: 'Under maintenance' };
        else overall = { key: 'operational', label: 'All systems operational' };
    }
    return { counts, total, operational: counts.operational, overall };
}

/* ─── images ──────────────────────────────────────────────────────────── */

const imageCache = new Map();
const IMAGE_CACHE_MAX = 40;

// Cloudinary stores logos in whatever format was uploaded (webp/svg/avif…).
// react-pdf only embeds PNG/JPEG, so ask Cloudinary for a bounded PNG, with
// solid/transparent padding trimmed so the mark fills its box on the page.
function pdfFriendlyUrl(url) {
    const m = String(url).match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)([^?#]*)/i);
    if (!m) return url;
    let rest = m[2];
    const lastSlash = rest.lastIndexOf('/');
    const file = rest.slice(lastSlash + 1);
    rest = /\.[a-z0-9]{2,5}$/i.test(file)
        ? rest.replace(/\.[a-z0-9]{2,5}$/i, '.png')
        : `${rest}.png`;
    return `${m[1]}e_trim:10/f_png,w_600,h_600,c_limit/${rest}`;
}

function sniffFormat(buf) {
    if (!buf || buf.length < 4) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    return null;
}

async function fetchImage(url) {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    if (imageCache.has(url)) return imageCache.get(url);
    let img = null;
    try {
        const res = await axios.get(pdfFriendlyUrl(url), {
            responseType: 'arraybuffer',
            timeout: 8000,
            maxContentLength: 8 * 1024 * 1024,
        });
        const data = Buffer.from(res.data);
        const format = sniffFormat(data);
        if (format) img = { data, format };
        else console.warn('Report PDF: unsupported image format for', url);
    } catch (err) {
        console.warn('Report PDF: could not load image', url, err.message);
        return null; // don't cache failures — the next render retries
    }
    if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(url, img);
    return img;
}

let defaultLogo = null;
function getDefaultLogo() {
    if (!defaultLogo) defaultLogo = { data: fs.readFileSync(DEFAULT_LOGO_PATH), format: 'png' };
    return defaultLogo;
}

// Brand logo: uploaded one if it loads, else the bundled Arixy mark.
async function loadBrandLogo(branding) {
    return (await fetchImage(branding?.logoUrl)) || getDefaultLogo();
}

const initials = (name) => String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/* ─── document ────────────────────────────────────────────────────────── */

const PAGE_W = 595.28;
const PAD_X = 44;
const HEADER_H = 50;
const FOOTER_H = 44;
const CONTENT_W = PAGE_W - PAD_X * 2;

function buildDocument(lib, { report, company, branding, brandLogo, clientLogo }) {
    const { React, Document, Page, View, Text, Image, Link, Svg, Defs, LinearGradient, RadialGradient, Stop, Rect, Circle } = lib;
    const h = React.createElement;

    const accent = normalizeHex(branding.accentColor);
    const accentTint = tint(accent, 0.9);
    const accentTrack = tint(accent, 0.84);
    const brandName = branding.brandName || 'Arixy Tech';
    const companyName = company?.name || 'Client';
    const title = report.title || 'Monthly Server Report';
    const label = periodLabel(report.periodStart, report.periodEnd);
    const svc = serviceSummary(report.services || []);

    const metrics = (report.metrics || []).filter((m) => m && m.name);
    const services = (report.services || []).filter((s) => s && s.name);
    const fixes = (report.fixes || []).filter((f) => f && f.title);
    const info = (report.serverInfo || []).filter((i) => i && i.label && i.value);

    const para = (text, style) => paragraphs(text).map((p, i) => h(Text, {
        key: i,
        style: [style, rtl(p), i > 0 ? { marginTop: 7 } : null],
    }, p));

    /* running header — repeated on every page; on page 1 the hero (later in
       the tree, so painted on top) covers it. react-pdf drops Text returned
       from a View `render` prop, so this is static rather than page-aware. */
    const runningHeader = h(View, {
        fixed: true,
        style: {
            position: 'absolute',
            top: 0,
            left: PAD_X,
            right: PAD_X,
            height: HEADER_H,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
            borderBottomColor: C.line,
        },
    },
    h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
        h(Image, { src: brandLogo, style: { width: 16, height: 16, objectFit: 'contain', marginRight: 7 } }),
        h(Text, { style: { fontSize: 8.5, fontWeight: 700, color: C.ink } }, brandName),
        h(Text, { style: { fontSize: 8.5, color: C.faint, marginHorizontal: 7 } }, '/'),
        h(Text, { style: { fontSize: 8.5, color: C.muted } }, `${title} · ${label}`)),
    h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
        h(Text, { style: { fontSize: 8.5, color: C.text2, fontWeight: 500 } }, companyName),
        clientLogo
            ? h(Image, { src: clientLogo, style: { width: 44, height: 18, objectFit: 'contain', marginLeft: 9 } })
            : null));

    /* footer (every page); the page counter is its own top-level fixed Text
       because `render` only works there */
    const footer = h(View, {
        fixed: true,
        style: {
            position: 'absolute',
            bottom: 0,
            left: PAD_X,
            right: PAD_X,
            height: FOOTER_H,
            flexDirection: 'row',
            alignItems: 'center',
            borderTopWidth: 1,
            borderTopColor: C.line,
        },
    },
    h(Text, { style: { fontSize: 7.5, color: C.muted, maxWidth: CONTENT_W - 80 } },
        `${brandName}  ·  ${title}  ·  ${companyName}  ·  ${label}`));

    // NB: must not have (or inherit) a lineHeight — react-pdf silently drops
    // dynamic text that does. The page itself therefore sets none.
    const pageCounter = h(Text, {
        fixed: true,
        style: {
            position: 'absolute',
            bottom: FOOTER_H / 2 - 5,
            right: PAD_X,
            width: 80,
            textAlign: 'right',
            fontSize: 7.5,
            color: C.text2,
            fontWeight: 700,
        },
        render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`,
    });

    /* hero (page 1) */
    const metaCell = (lbl, value, extra) => h(View, { style: { flex: 1, paddingRight: 10 } },
        h(Text, { style: { fontSize: 6.8, letterSpacing: 1.1, color: C.heroLabel, fontWeight: 700, marginBottom: 4 } }, lbl.toUpperCase()),
        extra || h(Text, { style: { fontSize: 9.5, color: C.white, fontWeight: 500 } }, value));

    const overallCell = svc.overall
        ? metaCell('Overall status', null, h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
            h(View, { style: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: STATUS[svc.overall.key].onDark, marginRight: 6 } }),
            h(Text, { style: { fontSize: 9.5, color: C.white, fontWeight: 500 } }, svc.overall.label)))
        : null;

    const clientTile = clientLogo
        ? h(View, { style: { width: 128, height: 58, backgroundColor: C.white, borderRadius: 10, padding: 9, alignItems: 'center', justifyContent: 'center' } },
            h(Image, { src: clientLogo, style: { width: 110, height: 40, objectFit: 'contain' } }))
        : h(View, { style: { width: 58, height: 58, backgroundColor: accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } },
            h(Text, { style: { fontSize: 20, fontWeight: 700, color: C.white } }, initials(companyName)));

    const hero = h(View, {
        style: {
            marginTop: -(HEADER_H + 20),
            marginHorizontal: -PAD_X,
            backgroundColor: C.ink,
            position: 'relative',
        },
    },
    // soft brand glows
    h(Svg, { width: 360, height: 360, style: { position: 'absolute', top: -120, right: -90 } },
        h(Defs, null,
            h(RadialGradient, { id: 'glowViolet', cx: '50%', cy: '50%', r: '50%' },
                h(Stop, { offset: '0%', stopColor: '#8B5CF6', stopOpacity: 0.55 }),
                h(Stop, { offset: '100%', stopColor: '#8B5CF6', stopOpacity: 0 }))),
        h(Circle, { cx: 180, cy: 180, r: 180, fill: 'url(#glowViolet)' })),
    h(Svg, { width: 260, height: 260, style: { position: 'absolute', top: 90, right: 150 } },
        h(Defs, null,
            h(RadialGradient, { id: 'glowCyan', cx: '50%', cy: '50%', r: '50%' },
                h(Stop, { offset: '0%', stopColor: '#22D3EE', stopOpacity: 0.22 }),
                h(Stop, { offset: '100%', stopColor: '#22D3EE', stopOpacity: 0 }))),
        h(Circle, { cx: 130, cy: 130, r: 130, fill: 'url(#glowCyan)' })),

    h(View, { style: { paddingTop: 34, paddingHorizontal: PAD_X } },
        // logos row
        h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } },
            h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
                h(Image, { src: brandLogo, style: { width: 34, height: 34, objectFit: 'contain', marginRight: 10 } }),
                h(View, null,
                    h(Text, { style: { fontSize: 13, fontWeight: 700, color: C.white, letterSpacing: 0.3 } }, brandName),
                    branding.website ? h(Text, { style: { fontSize: 8, color: C.heroMuted, marginTop: 1 } }, branding.website) : null)),
            clientTile),

        h(Text, { style: { marginTop: 44, fontSize: 8.5, letterSpacing: 2.2, color: C.cyan, fontWeight: 700 } }, title.toUpperCase()),
        h(Text, { style: { marginTop: 8, fontSize: 34, lineHeight: 1.1, fontWeight: 700, color: C.white } }, label),
        h(Text, { style: { marginTop: 8, fontSize: 12.5, color: C.heroMuted } },
            'Prepared for ',
            h(Text, { style: { color: C.white, fontWeight: 700 } }, companyName)),

        h(View, {
            style: {
                marginTop: 30,
                paddingVertical: 16,
                borderTopWidth: 1,
                borderTopColor: 'rgba(255,255,255,0.12)',
                flexDirection: 'row',
            },
        },
        metaCell('Reporting period', periodRange(report.periodStart, report.periodEnd)),
        metaCell('Prepared by', brandName),
        metaCell('Issued', fmtDate(report.publishedAt || new Date(), { short: true })),
        overallCell)),

    // brand stripe
    h(Svg, { width: PAGE_W, height: 5 },
        h(Defs, null,
            h(LinearGradient, { id: 'stripe', x1: '0', y1: '0', x2: '1', y2: '0' },
                ...BRAND_STRIPE.map((c, i) => h(Stop, { key: c, offset: `${(i / (BRAND_STRIPE.length - 1)) * 100}%`, stopColor: c })))),
        h(Rect, { x: 0, y: 0, width: PAGE_W, height: 5, fill: 'url(#stripe)' })));

    /* at a glance */
    const highlighted = metrics.filter((m) => m.highlight);
    const glanceMetrics = (highlighted.length ? highlighted : metrics.filter((m) => /uptime|availability/i.test(m.name))).slice(0, 2);
    const tiles = [];
    if (svc.total) {
        tiles.push({ label: 'Services up', value: `${svc.operational}/${svc.total}`, sub: svc.overall.label, color: STATUS[svc.overall.key].color });
    }
    glanceMetrics.forEach((m) => tiles.push({ label: m.name, value: fmtNum(m.value), unit: m.unit, sub: m.description ? m.description.split('\n')[0] : 'This period', color: accent }));
    if (fixes.length) tiles.push({ label: 'Work items', value: String(fixes.length), sub: 'fixes & maintenance done', color: '#B517F5' });

    const glance = tiles.length ? h(View, { wrap: false, style: { flexDirection: 'row', marginTop: 24 } },
        ...tiles.slice(0, 4).map((t, i) => h(View, {
            key: i,
            style: {
                flex: 1,
                marginLeft: i ? 10 : 0,
                padding: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: C.line,
                backgroundColor: C.soft,
            },
        },
        h(View, { style: { width: 18, height: 3, borderRadius: 2, backgroundColor: t.color, marginBottom: 9 } }),
        h(Text, { maxLines: 1, style: { fontSize: 7, lineHeight: 1.2, letterSpacing: 0.9, color: C.muted, fontWeight: 700 } }, t.label.toUpperCase()),
        h(View, { style: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 } },
            h(Text, { style: { fontSize: 19, lineHeight: 1.1, fontWeight: 700, color: C.ink } }, t.value),
            t.unit ? h(Text, { style: { fontSize: 9, lineHeight: 1.2, color: C.muted, marginLeft: 2, marginBottom: 1.5 } }, t.unit) : null),
        h(Text, { maxLines: 2, style: { fontSize: 7.5, lineHeight: 1.4, color: C.muted, marginTop: 5 } }, t.sub)))) : null;

    /* section scaffolding
       A section is a numbered heading plus content. The heading is laid out
       unbreakably together with the first block (`lead`) so it can never be
       stranded at the bottom of a page. Long free text is `breakable`: the
       heading then only asks for some of the text to follow it. */
    let sectionNo = 0;
    const section = (sectionTitle, aside, { lead, rest = [], breakable = false }) => {
        sectionNo += 1;
        const heading = h(View, { minPresenceAhead: breakable ? 70 : 0, style: { marginBottom: 12 } },
            h(View, { style: { flexDirection: 'row', alignItems: 'flex-end' } },
                h(Text, { style: { fontSize: 9, lineHeight: 1.2, fontWeight: 700, color: accent, letterSpacing: 1, marginRight: 8, marginBottom: 1.5 } }, String(sectionNo).padStart(2, '0')),
                h(Text, { style: { fontSize: 15, lineHeight: 1.2, fontWeight: 700, color: C.ink } }, sectionTitle),
                aside ? h(Text, { style: { flex: 1, textAlign: 'right', fontSize: 8, lineHeight: 1.2, color: C.muted, marginBottom: 1.5 } }, aside) : null),
            h(View, { style: { marginTop: 8, height: 1, backgroundColor: C.line } },
                h(View, { style: { width: 28, height: 2, marginTop: -0.5, backgroundColor: accent } })));
        return h(View, { key: sectionTitle, style: { marginTop: 28 } },
            breakable ? heading : h(View, { wrap: false }, heading, lead),
            breakable ? lead : null,
            ...rest);
    };

    const LONG_TEXT = 1200;
    const sections = [];

    const summaryParas = paragraphs(report.summary);
    if (summaryParas.length) {
        const [first, ...more] = para(report.summary, { fontSize: 10.5, lineHeight: 1.65, color: C.text2 });
        sections.push(section('Executive summary', null, {
            lead: first,
            rest: more,
            breakable: summaryParas[0].length > LONG_TEXT,
        }));
    }

    if (info.length) {
        const cols = info.length <= 2 ? 2 : 3;
        sections.push(section('Server overview', null, {
            lead: h(View, {
                style: {
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    backgroundColor: C.soft,
                    borderWidth: 1,
                    borderColor: C.line,
                    borderRadius: 10,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                },
            }, ...info.map((it, i) => h(View, { key: i, style: { width: `${100 / cols}%`, paddingVertical: 6, paddingRight: 10 } },
                h(Text, { style: { fontSize: 6.8, lineHeight: 1.2, letterSpacing: 1, color: C.muted, fontWeight: 700, marginBottom: 4 } }, it.label.toUpperCase()),
                h(Text, { style: [{ fontSize: 10, lineHeight: 1.35, fontWeight: 500, color: C.ink }, rtl(it.value)] }, it.value)))),
        }));
    }

    if (metrics.length) {
        const cardW = (CONTENT_W - 12) / 2;
        const metricCard = (m, i) => {
            const unit = (m.unit || '').trim();
            const isPct = unit === '%';
            const hasMax = isNum(m.max) && Number(m.max) > 0;
            const max = hasMax ? Number(m.max) : (isPct ? 100 : null);
            const pct = max && isNum(m.value) ? Math.max(0, Math.min(100, (Number(m.value) / max) * 100)) : null;
            const unitSep = unit && !isPct ? ' ' : '';
            return h(View, {
                key: i,
                style: {
                    width: cardW,
                    padding: 14,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: C.line,
                    backgroundColor: C.white,
                },
            },
            h(Text, { style: [{ fontSize: 9, lineHeight: 1.3, fontWeight: 500, color: C.text2 }, rtl(m.name)] }, m.name),
            h(View, { style: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 } },
                h(Text, { style: { fontSize: 22, lineHeight: 1.1, fontWeight: 700, color: C.ink } }, fmtNum(m.value)),
                unit ? h(Text, { style: { fontSize: 10.5, lineHeight: 1.2, color: C.muted, marginLeft: 3, marginBottom: 2 } }, unit) : null),
            pct !== null ? h(View, { style: { marginTop: 10 } },
                h(View, { style: { height: 6, borderRadius: 3, backgroundColor: accentTrack } },
                    h(View, { style: { width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: accent } })),
                // A plain percentage already says it all; "x of y" needs the ratio.
                hasMax ? h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 } },
                    h(Text, { style: { fontSize: 7.5, lineHeight: 1.2, color: C.muted } }, `of ${fmtNum(max)}${unitSep}${unit}`),
                    h(Text, { style: { fontSize: 7.5, lineHeight: 1.2, color: C.text2, fontWeight: 700 } }, `${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%`)) : null) : null,
            m.description ? h(Text, { style: [{ fontSize: 8.3, lineHeight: 1.5, color: C.muted, marginTop: 8 }, rtl(m.description)] }, m.description) : null);
        };
        const rows = [];
        for (let i = 0; i < metrics.length; i += 2) {
            rows.push(h(View, {
                key: i,
                wrap: false,
                style: { flexDirection: 'row', justifyContent: 'space-between', marginTop: i ? 12 : 0 },
            }, metricCard(metrics[i], i), metrics[i + 1] ? metricCard(metrics[i + 1], i + 1) : null));
        }
        const [firstRow, ...moreRows] = rows;
        sections.push(section('Performance metrics', `${metrics.length} metric${metrics.length === 1 ? '' : 's'} tracked`, {
            lead: firstRow,
            rest: moreRows,
        }));
    }

    if (services.length) {
        const nonZero = STATUS_ORDER.filter((k) => svc.counts[k] > 0);
        const statusPill = (key) => {
            const st = STATUS[key] || STATUS.operational;
            return h(View, { style: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: st.bg, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8 } },
                h(View, { style: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: st.color, marginRight: 5 } }),
                h(Text, { style: { fontSize: 7.5, lineHeight: 1, fontWeight: 700, color: st.color } }, st.label));
        };
        const colW = ['34%', '20%', '46%'];
        const cell = (i, child) => h(View, { style: { width: colW[i], paddingRight: i < 2 ? 10 : 0 } }, child);

        const summaryCard = h(View, {
            style: {
                flexDirection: 'row',
                alignItems: 'center',
                padding: 14,
                borderRadius: 10,
                backgroundColor: C.soft,
                borderWidth: 1,
                borderColor: C.line,
                marginBottom: 12,
            },
        },
        h(View, { style: { width: 150 } },
            h(Text, { style: { fontSize: 20, fontWeight: 700, color: C.ink, lineHeight: 1.1 } },
                `${svc.operational}`,
                h(Text, { style: { fontSize: 11, color: C.muted, fontWeight: 500 } }, ` / ${svc.total}`)),
            h(Text, { style: { fontSize: 8, lineHeight: 1.3, color: C.muted, marginTop: 4 } }, 'services fully operational')),
        h(View, { style: { flex: 1 } },
            h(View, { style: { flexDirection: 'row', height: 8 } },
                ...nonZero.map((k, i) => h(View, {
                    key: k,
                    style: {
                        flex: svc.counts[k],
                        backgroundColor: STATUS[k].color,
                        marginLeft: i ? 2 : 0,
                        borderTopLeftRadius: i === 0 ? 4 : 0,
                        borderBottomLeftRadius: i === 0 ? 4 : 0,
                        borderTopRightRadius: i === nonZero.length - 1 ? 4 : 0,
                        borderBottomRightRadius: i === nonZero.length - 1 ? 4 : 0,
                    },
                }))),
            h(View, { style: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 } },
                ...nonZero.map((k) => h(View, { key: k, style: { flexDirection: 'row', alignItems: 'center', marginRight: 14 } },
                    h(View, { style: { width: 6, height: 6, borderRadius: 3, backgroundColor: STATUS[k].color, marginRight: 5 } }),
                    h(Text, { style: { fontSize: 8, lineHeight: 1.2, color: C.text2 } }, `${STATUS[k].label} `,
                        h(Text, { style: { fontWeight: 700, color: C.ink } }, String(svc.counts[k]))))))));

        // Table; its header row is `fixed` so it repeats if the table breaks.
        const table = h(View, { style: { borderWidth: 1, borderColor: C.line, borderRadius: 10 } },
            h(View, {
                fixed: true,
                minPresenceAhead: 40,
                style: {
                    flexDirection: 'row',
                    backgroundColor: C.ink,
                    borderTopLeftRadius: 9,
                    borderTopRightRadius: 9,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                },
            },
            ...['Service', 'Status', 'Notes'].map((t, i) => cell(i, h(Text, { style: { fontSize: 7, lineHeight: 1.2, letterSpacing: 1, fontWeight: 700, color: C.white } }, t.toUpperCase())))),
            ...services.map((s, i) => h(View, {
                key: i,
                wrap: false,
                style: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 9,
                    paddingHorizontal: 12,
                    backgroundColor: i % 2 ? C.zebra : C.white,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: C.line,
                    borderBottomLeftRadius: i === services.length - 1 ? 9 : 0,
                    borderBottomRightRadius: i === services.length - 1 ? 9 : 0,
                },
            },
            cell(0, h(Text, { style: [{ fontSize: 9.5, lineHeight: 1.35, fontWeight: 700, color: C.ink }, rtl(s.name)] }, s.name)),
            cell(1, statusPill(s.status)),
            cell(2, h(Text, { style: [{ fontSize: 8.5, color: C.text2, lineHeight: 1.45 }, rtl(s.notes)] }, s.notes || '—')))));

        sections.push(section('Services health check', `Status as of ${fmtDate(report.periodEnd, { short: true })}`, {
            lead: summaryCard,
            rest: [table],
        }));
    }

    if (fixes.length) {
        const fixItem = (f, i) => h(View, { key: i, wrap: false, style: { flexDirection: 'row' } },
            h(View, { style: { width: 30, alignItems: 'center' } },
                h(View, { style: { width: 20, height: 20, borderRadius: 10, backgroundColor: accentTint, alignItems: 'center', justifyContent: 'center' } },
                    h(Text, { style: { fontSize: 8, lineHeight: 1, fontWeight: 700, color: accent } }, String(i + 1))),
                i < fixes.length - 1 ? h(View, { style: { width: 1.2, flexGrow: 1, backgroundColor: C.line, marginTop: 3 } }) : null),
            h(View, { style: { flex: 1, paddingLeft: 8, paddingBottom: i < fixes.length - 1 ? 14 : 0, paddingTop: 2 } },
                h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' } },
                    h(Text, { style: [{ flex: 1, fontSize: 10.5, lineHeight: 1.35, fontWeight: 700, color: C.ink }, rtl(f.title)] }, f.title),
                    f.date && validDate(toDate(f.date)) ? h(Text, { style: { fontSize: 7.5, lineHeight: 1.2, color: C.muted, marginLeft: 12, marginTop: 2 } }, fmtDate(f.date, { short: true })) : null),
                f.description ? h(Text, { style: [{ fontSize: 9, lineHeight: 1.55, color: C.text2, marginTop: 3 }, rtl(f.description)] }, f.description) : null));
        const [firstFix, ...moreFixes] = fixes.map(fixItem);
        sections.push(section('Fixes & work completed', `${fixes.length} item${fixes.length === 1 ? '' : 's'} this period`, {
            lead: firstFix,
            rest: moreFixes,
        }));
    }

    const notesParas = paragraphs(report.notes);
    if (notesParas.length) {
        sections.push(section('Notes & recommendations', null, {
            lead: h(View, { style: { flexDirection: 'row', backgroundColor: accentTint, borderRadius: 8 } },
                h(View, { style: { width: 3, backgroundColor: accent, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 } }),
                h(View, { style: { flex: 1, paddingVertical: 14, paddingHorizontal: 16 } },
                    ...para(report.notes, { fontSize: 10, lineHeight: 1.6, color: C.text2 }))),
            breakable: notesParas.join('').length > LONG_TEXT,
        }));
    }

    if (!sections.length && !tiles.length) {
        sections.push(h(Text, { key: 'empty', style: { marginTop: 28, fontSize: 10, color: C.muted } }, 'No details have been added to this report yet.'));
    }

    /* sign-off */
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
            h(Text, { style: { fontSize: 9.5, lineHeight: 1.3, fontWeight: 700, color: C.ink } }, `Prepared by ${brandName}`),
            ...contactLines.map((line, i) => h(Text, { key: i, style: { fontSize: 8, lineHeight: 1.35, color: C.muted, marginTop: i ? 0 : 2 } }, line)))),
    h(View, { style: { width: '44%', alignItems: 'flex-end' } },
        h(Text, { style: { fontSize: 9.5, lineHeight: 1.3, fontWeight: 700, color: C.ink } }, 'Questions about this report?'),
        h(Text, { style: { fontSize: 8, lineHeight: 1.35, color: C.muted, marginTop: 2, textAlign: 'right' } }, 'Reply to our email or open a ticket in your client portal.'),
        branding.portalUrl ? h(Link, { src: branding.portalUrl, style: { fontSize: 8, color: accent, marginTop: 4, textDecoration: 'none', fontWeight: 700 } }, 'Open client portal →') : null));

    return h(Document, {
        title: `${title} — ${companyName} — ${label}`,
        author: brandName,
        subject: `${title} for ${companyName} (${label})`,
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
            fontFamily: FONT,
            fontSize: 9.5,
            color: C.text,
            backgroundColor: C.white,
        },
    },
    runningHeader,
    hero,
    glance,
    ...sections,
    signOff,
    footer,
    pageCounter));
}

/**
 * Render a report to a PDF Buffer.
 * @param {object} args
 * @param {object} args.report   plain ServerReport-shaped object (saved or unsaved)
 * @param {object} args.company  { name, logo }
 * @param {object} args.branding ReportSettings-shaped object
 */
async function renderServerReportPdf({ report, company, branding = {} }) {
    const lib = await loadLib();
    const [brandLogo, clientLogo] = await Promise.all([
        loadBrandLogo(branding),
        fetchImage(company?.logo),
    ]);
    const doc = buildDocument(lib, { report, company, branding, brandLogo, clientLogo });
    return lib.renderToBuffer(doc);
}

module.exports = {
    renderServerReportPdf,
    loadBrandLogo,
    periodLabel,
    periodRange,
    fmtDate,
    reportFilename,
    serviceSummary,
    STATUS,
};
