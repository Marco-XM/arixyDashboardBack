// Exchange rates for the finance module.
//
// Latest rates come from open.er-api.com (free, no key, updated daily) with
// the fawazahmed0 currency-api as a fallback; past days use the
// currency-api's dated snapshot for that day. Everything is stored relative
// to 1 USD and cached in Mongo (models/FxRate.js) so a serverless cold start
// doesn't hit the providers: 'latest' is refreshed on demand once it is
// older than LATEST_MAX_AGE, past days are kept forever.
//
// Best practice for the books: one-off transactions (payments, invoices,
// one-time purchases) lock their home-currency value at the rate of their
// own date when saved (lockFx); recurring charges and salaries are valued at
// the rate of each charge date / month, which is fixed once that date passes.

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

const dayKeyOf = (d) => new Date(d).toISOString().slice(0, 10);

// Rates for a calendar day ("2026-07-02"). Past days are stored forever, so
// a value converted at a past day's rate never changes; today and future
// days use the latest rates.
async function getDay(date) {
    const key = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : dayKeyOf(date);
    if (key >= dayKeyOf(new Date())) return getLatest();
    if (memory.has(key)) return memory.get(key);
    const doc = await FxRate.findOne({ key }).lean();
    if (doc) { memory.set(key, doc); return doc; }
    try {
        return await store(key, await fetchCurrencyApi(key));
    } catch (err) {
        console.warn('FX: falling back to latest rates for', key);
        return getLatest();
    }
}

// Rates for a calendar month ("2026-07"): the rate on the 15th, so a month's
// figure is fixed from the 16th on (latest rates until then).
const getMonth = (key) => getDay(`${key}-15`);

// The books are kept in this currency: payments, invoices and one-off
// purchases store their value in it at the rate of their own date.
const HOME_CURRENCY = 'EGP';

// Whether a stored market-rate lock still matches the record (same amount,
// currency and date), so re-saving it keeps the original rate.
function lockMatches(f, amount, currency, date) {
    if (!f || !f.home || !f.date || f.manual) return false;
    if (new Date(f.date).getTime() !== new Date(date).getTime()) return false;
    const a = Number(amount || 0);
    if (String(currency || '').toUpperCase() === f.home) return f.amountHome === a;
    return Math.abs(f.rate * a - f.amountHome) < 0.005;
}

// Value to store on a record when it is saved: its amount in the home
// currency at the rate of `date`, or the amount actually charged/received
// when one is given (`manualHome`). Undefined when no rate is available —
// callers then fall back to the day's rate at read time.
async function lockFx(amount, currency, date, manualHome) {
    const cur = String(currency || HOME_CURRENCY).toUpperCase();
    const a = Number(amount || 0);
    const at = date ? new Date(date) : new Date();
    if (cur === HOME_CURRENCY) {
        return { home: HOME_CURRENCY, rate: 1, amountHome: a, date: at, source: 'same currency', manual: false };
    }
    if (manualHome !== undefined && manualHome !== null && manualHome !== '' && Number(manualHome) >= 0) {
        const amountHome = Number(manualHome);
        return { home: HOME_CURRENCY, rate: a ? amountHome / a : 0, amountHome, date: at, source: 'actual amount', manual: true };
    }
    try {
        const day = await getDay(at);
        const amountHome = convert(a, cur, HOME_CURRENCY, day.rates);
        if (amountHome === null) return undefined;
        return { home: HOME_CURRENCY, rate: day.rates[HOME_CURRENCY] / day.rates[cur], amountHome, date: at, source: day.source, manual: false };
    } catch (err) {
        console.warn('FX: could not lock a rate:', err.message);
        return undefined;
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

module.exports = { getLatest, getMonth, getDay, lockFx, lockMatches, convert, monthKeyOf, dayKeyOf, HOME_CURRENCY };
