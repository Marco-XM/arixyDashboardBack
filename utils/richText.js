// Inline rich text for client reports.
//
// The dashboard editor produces contentEditable HTML. Before it is stored it
// is reduced to a tiny whitelist — <b> <u> <s> <mark> <a href> <br> — which
// the PDF renderer turns into styled text runs. Everything else (spans,
// styles, scripts, block tags…) is stripped; block tags become line breaks.

const MAX_HTML = 20000;

const TAG_MAP = {
    b: 'b', strong: 'b',
    u: 'u', ins: 'u',
    s: 's', strike: 's', del: 's',
    mark: 'mark',
    a: 'a',
};

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// http(s)/mailto only; bare domains get https://.
function safeHref(raw) {
    const href = decodeEntities(String(raw || '').trim());
    if (!href) return '';
    if (/^(https?:|mailto:)/i.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return ''; // javascript:, data:, …
    return `https://${href.replace(/^\/+/, '')}`;
}

function sanitizeInline(input) {
    let html = String(input == null ? '' : input).slice(0, MAX_HTML);
    html = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|template|iframe|object)[\s\S]*?<\/\1\s*>/gi, '')
        // contentEditable wraps new lines in <div>/<p>; keep them as breaks.
        .replace(/<(div|p|li|h[1-6])(\s[^>]*)?>/gi, '<br>')
        .replace(/<\/(div|p|li|h[1-6])\s*>/gi, '');

    const out = html.replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (_whole, close, name, attrs) => {
        const tag = name.toLowerCase();
        if (tag === 'br') return close ? '' : '<br>';
        const mapped = TAG_MAP[tag];
        if (!mapped) return '';
        if (close) return `</${mapped}>`;
        if (mapped === 'a') {
            const m = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
            const href = safeHref(m ? (m[2] ?? m[3] ?? m[4]) : '');
            return href ? `<a href="${escapeAttr(href)}">` : '<a>';
        }
        return `<${mapped}>`;
    });

    // Stray "<" left by malformed markup must not become a tag later.
    return out
        .replace(/<(?!\/?(?:b|u|s|mark|br|a)>|a href="[^"]*">)/gi, '&lt;')
        .replace(/^(\s|<br>|&nbsp;)+/i, '')
        .replace(/(\s|<br>|&nbsp;)+$/i, '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
        if (code[0] === '#') {
            const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
        }
        return ENTITIES[code.toLowerCase()] ?? m;
    });
}

// Sanitized HTML → [{ text, bold, underline, strike, mark, href }].
// Line breaks are "\n" inside text.
function parseInline(html) {
    const runs = [];
    const state = { b: 0, u: 0, s: 0, mark: 0 };
    const links = [];
    const push = (text) => {
        if (!text) return;
        runs.push({
            text,
            bold: state.b > 0,
            underline: state.u > 0,
            strike: state.s > 0,
            mark: state.mark > 0,
            href: links.length ? links[links.length - 1] : '',
        });
    };
    const re = /<(\/?)(b|u|s|mark|a|br)\b([^>]*)>/gi;
    let last = 0;
    let m;
    const src = String(html || '');
    while ((m = re.exec(src))) {
        push(decodeEntities(src.slice(last, m.index)));
        last = re.lastIndex;
        const [, close, rawTag, attrs] = m;
        const tag = rawTag.toLowerCase();
        if (tag === 'br') { push('\n'); continue; }
        if (tag === 'a') {
            if (close) links.pop();
            else {
                const hm = attrs.match(/href="([^"]*)"/i);
                links.push(hm ? decodeEntities(hm[1]) : '');
            }
            continue;
        }
        state[tag] = Math.max(0, state[tag] + (close ? -1 : 1));
    }
    push(decodeEntities(src.slice(last)));
    return runs;
}

const plainText = (html) => parseInline(html).map((r) => r.text).join('').trim();

module.exports = { sanitizeInline, parseInline, plainText, decodeEntities, safeHref };
