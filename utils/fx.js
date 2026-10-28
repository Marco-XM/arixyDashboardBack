// Exchange rates for the finance module.
//
// Latest rates come from open.er-api.com (free, no key, updated daily) with
// the fawazahmed0 currency-api as a fallback; past months use the
// currency-api's dated snapshot for the 15th of that month. Everything is
// stored relative to 1 USD and cached in Mongo (models/FxRate.js) so a
// serverless cold start doesn't hit the providers: 'latest' is refreshed on
// demand once it is older than LATEST_MAX_AGE, past months are kept forever.

const axios = require('axios');
const FxRate = require('../models/FxRate');

const LATEST_MAX_AGE = 6 * 60 * 60 * 1000;
const memory = new Map(); // key → { rates, source, asOf, fetchedAt }

const get = async (url) => (await axios.get(url, { timeout: 8000 })).data;

// Uppercase codes, positive numbers only.
function clean(rates) {
    const out = {};
    Object.entries(rates || {}).forEach(([k, v]) => {
        const n = Number(v);
        if (/^[a-z]{3}$/i.test(k) && Number.isFinite(n) && n > 0) out[k.toUpperCase()] = n;
    });
    out.USD = 1;
    return out;
}

const currencyApi = (version) => [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${version}/v1/currencies/usd.json`,
    `https://${version}.currency-api.pages.dev/v1/currencies/usd.json`,
];

async function fetchLatestRemote() {
    try {
        const d = await get('https://open.er-api.com/v6/latest/USD');
        if (d.result === 'success' && d.rates) {
            return { rates: clean(d.rates), source: 'open.er-api.com', asOf: new Date(d.time_last_update_unix * 1000) };
        }
    } catch (err) {
        console.warn('FX: open.er-api.com failed:', err.message);
    }
    return fetchCurrencyApi('latest');
}

async function fetchCurrencyApi(version) {
    for (const url of currencyApi(version)) {
        try {
            const d = await get(url); // eslint-disable-line no-await-in-loop
            if (d?.usd) return { rates: clean(d.usd), source: 'currency-api (fawazahmed0)', asOf: new Date(`${d.date}T00:00:00Z`) };
        } catch (err) {
            console.warn('FX: currency-api failed:', url, err.message);
        }
    }
    throw new Error(`No exchange rates available for ${version}`);
}

async function store(key, data) {
    const doc = { key, base: 'USD', ...data, fetchedAt: new Date() };
    await FxRate.updateOne({ key }, { $set: doc }, { upsert: true });
    memory.set(key, doc);
    return doc;
}

// Latest rates; stale cached ones are returned if every provider is down.
async function getLatest({ force = false } = {}) {
    const fresh = (d) => d && Date.now() - new Date(d.fetchedAt).getTime() < LATEST_MAX_AGE;
    let doc = memory.get('latest');
    if (!force && fresh(doc)) return doc;
    doc = await FxRate.findOne({ key: 'latest' }).lean();
    if (!force && fresh(doc)) { memory.set('latest', doc); return doc; }
    try {
        return await store('latest', await fetchLatestRemote());
    } catch (err) {
        if (doc) return { ...doc, stale: true };
        throw err;
    }
}

const monthKeyOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// Rates for a calendar month ("2026-07"); the current and future months use
// the latest rates.
async function getMonth(key) {
    if (key >= monthKeyOf(new Date())) return getLatest();
    if (memory.has(key)) return memory.get(key);
    const doc = await FxRate.findOne({ key }).lean();
    if (doc) { memory.set(key, doc); return doc; }
    try {
        return await store(key, await fetchCurrencyApi(`${key}-15`));
    } catch (err) {
        console.warn('FX: falling back to latest rates for', key);
        return getLatest();
    }
}

// Convert between any two currencies with a USD-based rate table; null when
// either currency is unknown.
function convert(amount, from, to, rates) {
    const a = Number(amount || 0);
    const f = String(from || '').toUpperCase();
    const t = String(to || '').toUpperCase();
    if (f === t) return a;
    if (!rates?.[f] || !rates?.[t]) return null;
    return (a / rates[f]) * rates[t];
}

module.exports = { getLatest, getMonth, convert, monthKeyOf };
