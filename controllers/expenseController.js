const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const TeamMember = require('../models/TeamMember');
const Admin = require('../models/Admin');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const fx = require('../utils/fx');

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const date = (v) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
};
const fail = (res, status, message, error) => {
    if (error) console.error(message, error);
    res.status(status).json({ success: false, message, ...(error ? { error: error.message } : {}) });
};

// Months are handled as UTC "YYYY-MM" keys.
const monthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), 28)));
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const CYCLE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

/* ------------------------------- Expenses -------------------------------- */

function sanitizeExpense(b = {}) {
    const out = {};
    if (b.title !== undefined) out.title = str(b.title, 160);
    if (b.vendor !== undefined) out.vendor = str(b.vendor, 120);
    if (b.category !== undefined) out.category = str(b.category, 60) || 'Other';
    if (b.kind !== undefined) out.kind = b.kind === 'recurring' ? 'recurring' : 'one-time';
    if (b.billingCycle !== undefined) out.billingCycle = CYCLE_MONTHS[b.billingCycle] ? b.billingCycle : 'monthly';
    if (b.amount !== undefined) out.amount = Math.max(0, num(b.amount));
    if (b.currency !== undefined) out.currency = str(b.currency, 8).toUpperCase() || 'EGP';
    if (b.date !== undefined) out.date = date(b.date) || new Date();
    if (b.endDate !== undefined) out.endDate = date(b.endDate) || null;
    if (b.company !== undefined) out.company = mongoose.isValidObjectId(String(b.company || '')) ? b.company : null;
    if (b.paymentMethod !== undefined) out.paymentMethod = str(b.paymentMethod, 60);
    if (b.notes !== undefined) out.notes = str(b.notes, 2000);
    return out;
}

const listExpenses = async (req, res) => {
    try {
        const { kind, category, currency } = req.query;
        const filter = {};
        if (kind) filter.kind = kind;
        if (category) filter.category = category;
        if (currency) filter.currency = currency;
        const data = await Expense.find(filter).populate('company', 'name').sort({ date: -1 }).lean();
        const categories = await Expense.distinct('category');
        res.json({ success: true, data, categories });
    } catch (error) {
        fail(res, 500, 'Error fetching expenses', error);
    }
};

// One-time purchases lock their home-currency value at the purchase date's
// rate, or the actual amount charged when `amountHome` is given; an unchanged
// purchase keeps its lock. Recurring ones have no lock (each charge uses its
// own date's rate).
async function lockExpense(expense, amountHome) {
    if (expense.kind !== 'one-time') { expense.fx = undefined; return; }
    const manual = amountHome !== undefined && amountHome !== null && amountHome !== '';
    if (!manual && amountHome === undefined && expense.fx?.manual) return; // field not sent: keep
    if (!manual && fx.lockMatches(expense.fx, expense.amount, expense.currency, expense.date)) return;
    expense.fx = await fx.lockFx(expense.amount, expense.currency, expense.date, manual ? amountHome : undefined);
}

const createExpense = async (req, res) => {
    try {
        const input = sanitizeExpense(req.body);
        if (!input.title) return fail(res, 400, 'A name is required');
        if (input.amount === undefined) return fail(res, 400, 'An amount is required');
        const expense = new Expense({ ...input, createdBy: req.user?._id });
        await lockExpense(expense, req.body.amountHome);
        await expense.save();
        res.status(201).json({ success: true, message: 'Expense added', data: expense });
    } catch (error) {
        fail(res, 500, 'Error adding expense', error);
    }
};

const updateExpense = async (req, res) => {
    try {
        const input = sanitizeExpense(req.body);
        if (input.title === '') return fail(res, 400, 'A name is required');
        const expense = await Expense.findById(req.params.id);
        if (!expense) return fail(res, 404, 'Expense not found');
        expense.set(input);
        await lockExpense(expense, req.body.amountHome);
        await expense.save();
        res.json({ success: true, message: 'Expense updated', data: expense });
    } catch (error) {
        fail(res, 500, 'Error updating expense', error);
    }
};

const deleteExpense = async (req, res) => {
    try {
        const expense = await Expense.findByIdAndDelete(req.params.id);
        if (!expense) return fail(res, 404, 'Expense not found');
        res.json({ success: true, message: 'Expense deleted' });
    } catch (error) {
        fail(res, 500, 'Error deleting expense', error);
    }
};

/* --------------------------------- Team ---------------------------------- */

function sanitizeMember(b = {}) {
    const out = {};
    if (b.name !== undefined) out.name = str(b.name, 120);
    if (b.account !== undefined) out.account = mongoose.isValidObjectId(String(b.account || '')) ? b.account : null;
    if (b.role !== undefined) out.role = str(b.role, 120);
    if (b.email !== undefined) out.email = str(b.email, 200);
    if (b.currency !== undefined) out.currency = str(b.currency, 8).toUpperCase() || 'EGP';
    if (b.startDate !== undefined) out.startDate = date(b.startDate) ? monthStart(date(b.startDate)) : undefined;
    if (b.endDate !== undefined) out.endDate = date(b.endDate) ? monthStart(date(b.endDate)) : null;
    if (b.notes !== undefined) out.notes = str(b.notes, 2000);
    if (Array.isArray(b.salaries)) {
        out.salaries = b.salaries
            .map((s) => ({ amount: Math.max(0, num(s?.amount)), from: date(s?.from) ? monthStart(date(s.from)) : null }))
            .filter((s) => s.from);
    }
    return out;
}

const listTeam = async (req, res) => {
    try {
        const data = await TeamMember.find().sort({ endDate: 1, name: 1 }).lean();
        res.json({ success: true, data });
    } catch (error) {
        fail(res, 500, 'Error fetching team', error);
    }
};

// GET /api/finance/team/accounts — dashboard accounts to pick team members from.
const listTeamAccounts = async (req, res) => {
    try {
        const data = await Admin.find().select('name email username').sort({ name: 1 }).lean();
        res.json({ success: true, data });
    } catch (error) {
        fail(res, 500, 'Error fetching accounts', error);
    }
};

const createMember = async (req, res) => {
    try {
        const input = sanitizeMember(req.body);
        if (!input.name) return fail(res, 400, 'A name is required');
        if (!input.startDate) return fail(res, 400, 'A start month is required');
        if (!input.salaries?.length) return fail(res, 400, 'A monthly salary is required');
        const member = await TeamMember.create(input);
        res.status(201).json({ success: true, message: 'Team member added', data: member });
    } catch (error) {
        fail(res, 500, 'Error adding team member', error);
    }
};

const updateMember = async (req, res) => {
    try {
        const member = await TeamMember.findById(req.params.id);
        if (!member) return fail(res, 404, 'Team member not found');
        const input = sanitizeMember(req.body);
        if (input.name === '') return fail(res, 400, 'A name is required');
        if (input.salaries && !input.salaries.length) return fail(res, 400, 'A monthly salary is required');
        Object.assign(member, input);
        await member.save();
        res.json({ success: true, message: 'Team member updated', data: member });
    } catch (error) {
        fail(res, 500, 'Error updating team member', error);
    }
};

const deleteMember = async (req, res) => {
    try {
        const member = await TeamMember.findByIdAndDelete(req.params.id);
        if (!member) return fail(res, 404, 'Team member not found');
        res.json({ success: true, message: 'Team member removed' });
    } catch (error) {
        fail(res, 500, 'Error removing team member', error);
    }
};

/* ------------------------------- Overview -------------------------------- */

// Every charge date of a recurring expense between `from` and `to`.
function chargesBetween(expense, from, to) {
    const step = CYCLE_MONTHS[expense.billingCycle] || 1;
    const start = new Date(expense.date);
    const stop = expense.endDate && new Date(expense.endDate) < to ? new Date(expense.endDate) : to;
    const out = [];
    for (let i = 0, d = start; d <= stop && i < 1200; i += 1, d = addMonths(start, i * step)) {
        if (d >= from) out.push(d);
    }
    return out;
}

// Salary owed to a member for the month starting at `m` (0 if not on the team).
function salaryFor(member, m) {
    if (monthStart(new Date(member.startDate)) > m) return 0;
    if (member.endDate && monthStart(new Date(member.endDate)) < m) return 0;
    let amount = 0;
    (member.salaries || []).forEach((s) => { if (new Date(s.from) <= m) amount = s.amount; });
    return amount;
}

// Next charge date on or after `now` for an active recurring expense.
function nextCharge(expense, now) {
    if (expense.endDate && new Date(expense.endDate) < now) return null;
    const step = CYCLE_MONTHS[expense.billingCycle] || 1;
    const start = new Date(expense.date);
    for (let i = 0; i < 1200; i += 1) {
        const d = addMonths(start, i * step);
        if (d >= now) return expense.endDate && d > new Date(expense.endDate) ? null : d;
    }
    return null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const parseMonth = (v) => (MONTH_RE.test(String(v || '')) ? new Date(`${v}-01T00:00:00Z`) : null);
const monthEnd = (m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1) - 1);
const monthsBetween = (a, b) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());

// Expected income from a client subscription in month `m` (0 outside its
// active window; annual plans bill in their anniversary month).
function subscriptionIncome(sub, m) {
    if (sub.billingCycle === 'one-time') return 0;
    if (sub.startDate && new Date(sub.startDate) > monthEnd(m)) return 0;
    if (sub.endDate && new Date(sub.endDate) < m) return 0;
    if (sub.billingCycle === 'annual') {
        const anchor = new Date(sub.startDate || sub.createdAt);
        if (anchor.getUTCMonth() !== m.getUTCMonth()) return 0;
    }
    return Number(sub.price?.amount || 0);
}

// GET /api/finance/overview — revenue vs costs per month (cash basis:
// payments received vs expenses charged + salaries), plus a forecast.
//   currency      display currency (default EGP); every amount is converted
//                 at the exchange rate of the month it falls in (utils/fx.js)
//   from, to      YYYY-MM range (inclusive, `to` capped at this month), or
//   months        last N months (default 12) when no range is given
//   forecast      0–24 months after this month to predict
//   average=1     add the period's average project income to the forecast
const getOverview = async (req, res) => {
    try {
        const currency = str(req.query.currency, 8).toUpperCase() || 'EGP';
        const now = new Date();
        const thisMonth = monthStart(now);
        const thisKey = monthKey(thisMonth);

        let to = parseMonth(req.query.to) || thisMonth;
        if (to > thisMonth) to = thisMonth;
        let from = parseMonth(req.query.from);
        if (!from) from = addMonths(to, -(Math.min(60, Math.max(1, num(req.query.months, 12))) - 1));
        if (from > to) from = to;
        if (monthsBetween(from, to) > 59) from = addMonths(to, -59);
        const months = monthsBetween(from, to) + 1;
        const rangeEnd = monthEnd(to);
        const forecastMonths = Math.min(24, Math.max(0, Math.round(num(req.query.forecast, 0))));
        const includeAverage = req.query.average === '1';

        const series = [];
        for (let i = 0; i < months; i += 1) {
            const m = addMonths(from, i);
            series.push({ month: monthKey(m), start: m, collected: 0, invoiced: 0, expenses: 0, salaries: 0 });
        }
        const byKey = Object.fromEntries(series.map((s) => [s.month, s]));

        const [payments, invoices, expenses, team, latest] = await Promise.all([
            Payment.find({ paidAt: { $gte: from, $lte: rangeEnd } }).select('amount currency paidAt invoice fx').lean(),
            Invoice.find({ status: { $nin: ['draft', 'void'] }, issueDate: { $gte: from, $lte: rangeEnd } }).select('total currency issueDate fx').lean(),
            Expense.find().lean(),
            TeamMember.find().lean(),
            fx.getLatest().catch((err) => { console.warn('FX unavailable:', err.message); return null; }),
        ]);

        // Costs charged in a month: recurring charges + dated one-off purchases.
        const expenseCharges = (start, end) => expenses.flatMap((e) => (e.kind === 'recurring'
            ? chargesBetween(e, start, end).map((d) => ({ e, d }))
            : (new Date(e.date) >= start && new Date(e.date) <= end ? [{ e, d: new Date(e.date) }] : [])));
        const charges = expenseCharges(from, rangeEnd);

        // Rates are only needed when some amount is in another currency:
        // the rate of each transaction's own day, and each month's rate for
        // salaries. Past days/months are stored, so these never change.
        const usedCurrencies = new Set([...payments, ...invoices, ...expenses, ...team].map((x) => String(x.currency || '').toUpperCase()).filter(Boolean));
        const needsFx = [...usedCurrencies].some((c) => c !== currency);
        const monthRates = {};
        const dayRates = {};
        if (needsFx) {
            const days = new Set([
                ...payments.map((p) => fx.dayKeyOf(p.paidAt)),
                ...invoices.map((i) => fx.dayKeyOf(i.issueDate)),
                ...charges.map(({ d }) => fx.dayKeyOf(d)),
            ]);
            await Promise.all([
                ...series.map(async (s) => { monthRates[s.month] = await fx.getMonth(s.month).catch(() => latest); }),
                ...[...days].map(async (k) => { dayRates[k] = await fx.getDay(k).catch(() => latest); }),
            ]);
        }
        const unconverted = new Set();
        const convWith = (amount, cur, rates) => {
            const c = String(cur || currency).toUpperCase();
            if (c === currency) return Number(amount || 0);
            const v = fx.convert(amount, c, currency, rates);
            if (v === null) { unconverted.add(c); return 0; }
            return v;
        };
        const conv = (amount, cur, key) => convWith(amount, cur, (monthRates[key] || latest)?.rates);
        const convNow = (amount, cur) => convWith(amount, cur, latest?.rates);
        const convDay = (amount, cur, date) => convWith(amount, cur, (dayRates[fx.dayKeyOf(date)] || latest)?.rates);
        // Payments, invoices and one-time purchases use the home-currency value
        // locked when they were saved; older records without a lock fall back
        // to their own day's (stored) rate.
        const convLocked = (doc, amount, cur, date) => {
            if (String(cur || currency).toUpperCase() === currency) return Number(amount || 0);
            const f = doc.fx;
            if (f && f.home && Number.isFinite(f.amountHome)) {
                return f.home === currency ? f.amountHome : convDay(f.amountHome, f.home, date);
            }
            return convDay(amount, cur, date);
        };

        payments.forEach((p) => { const s = byKey[monthKey(new Date(p.paidAt))]; if (s) s.collected += convLocked(p, p.amount, p.currency, p.paidAt); });
        invoices.forEach((inv) => { const s = byKey[monthKey(new Date(inv.issueDate))]; if (s) s.invoiced += convLocked(inv, inv.total, inv.currency, inv.issueDate); });

        const byCategory = {};
        const addCategory = (cat, amount) => { byCategory[cat] = (byCategory[cat] || 0) + amount; };
        charges.forEach(({ e, d }) => {
            const k = monthKey(d);
            const s = byKey[k];
            if (!s) return;
            const v = e.kind === 'recurring' ? convDay(e.amount, e.currency, d) : convLocked(e, e.amount, e.currency, d);
            s.expenses += v;
            addCategory(e.category || 'Other', v);
        });
        series.forEach((s) => {
            team.forEach((m) => { s.salaries += conv(salaryFor(m, s.start), m.currency, s.month); });
            if (s.salaries) addCategory('Salaries', s.salaries);
        });

        series.forEach((s) => {
            s.costs = s.expenses + s.salaries;
            s.profit = s.collected - s.costs;
            delete s.start;
        });

        const sum = (rows, k) => rows.reduce((t, s) => t + s[k], 0);
        const totals = {
            collected: sum(series, 'collected'), invoiced: sum(series, 'invoiced'),
            expenses: sum(series, 'expenses'), salaries: sum(series, 'salaries'), costs: sum(series, 'costs'),
        };
        totals.profit = totals.collected - totals.costs;
        totals.margin = totals.collected > 0 ? totals.profit / totals.collected : null;

        // What the business costs to run each month right now (today's rates).
        const activeRecurring = expenses.filter((e) => e.kind === 'recurring' && new Date(e.date) <= now && (!e.endDate || new Date(e.endDate) >= now));
        const monthlySubscriptions = activeRecurring.reduce((t, e) => t + convNow(e.amount / (CYCLE_MONTHS[e.billingCycle] || 1), e.currency), 0);
        const monthlySalaries = team.reduce((t, m) => t + convNow(salaryFor(m, thisMonth), m.currency), 0);

        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const soon = new Date(today.getTime() + 30 * 86400000);
        const upcoming = expenses
            .filter((e) => e.kind === 'recurring')
            .map((e) => ({
                _id: e._id, title: e.title, vendor: e.vendor, billingCycle: e.billingCycle, next: nextCharge(e, today),
                amount: convNow(e.amount, e.currency), originalAmount: e.amount, originalCurrency: e.currency,
            }))
            .filter((e) => e.next && e.next <= soon)
            .sort((a, b) => a.next - b.next);

        /* ── forecast: the N months after this one, at today's rates ── */
        let forecast = null;
        if (forecastMonths > 0) {
            const fFrom = addMonths(thisMonth, 1);
            const fTo = monthEnd(addMonths(thisMonth, forecastMonths));
            const firstKey = monthKey(fFrom);
            const rows = [];
            for (let i = 0; i < forecastMonths; i += 1) {
                const m = addMonths(fFrom, i);
                rows.push({ month: monthKey(m), start: m, subscriptions: 0, invoices: 0, average: 0, expenses: 0, salaries: 0 });
            }
            const fKey = Object.fromEntries(rows.map((r) => [r.month, r]));
            const cnow = convNow;

            const [clientSubs, open, invoicedPeriods] = await Promise.all([
                Subscription.find({ status: 'active' }).select('price billingCycle startDate endDate createdAt').lean(),
                Invoice.find({ status: { $in: ['draft', 'sent', 'partial', 'overdue'] } }).select('total currency dueDate').lean(),
                Invoice.find({ subscription: { $ne: null }, status: { $ne: 'void' }, 'period.month': { $exists: true } }).select('subscription period').lean(),
            ]);

            // Unpaid balances (drafts included — they are bills still to send) land in
            // their due month; overdue or undated ones
            // are expected in the first forecast month.
            const paidRows = await Payment.aggregate([
                { $match: { invoice: { $in: open.map((i) => i._id) } } },
                { $group: { _id: '$invoice', total: { $sum: '$amount' } } },
            ]);
            const paidMap = Object.fromEntries(paidRows.map((p) => [String(p._id), p.total]));
            open.forEach((inv) => {
                const balance = Number(inv.total || 0) - (paidMap[String(inv._id)] || 0);
                if (balance <= 0) return;
                let k = inv.dueDate ? monthKey(new Date(inv.dueDate)) : firstKey;
                if (k < firstKey) k = firstKey;
                if (fKey[k]) fKey[k].invoices += cnow(balance, inv.currency);
            });

            // Client subscriptions, skipping periods that already have an invoice
            // (its unpaid balance is counted above).
            const invoiced = new Set(invoicedPeriods.map((i) => `${i.subscription}:${i.period.year}-${String(i.period.month).padStart(2, '0')}`));
            clientSubs.forEach((sub) => rows.forEach((r) => {
                if (invoiced.has(`${sub._id}:${r.month}`)) return;
                const v = subscriptionIncome(sub, r.start);
                if (v) r.subscriptions += cnow(v, sub.price?.currency);
            }));

            // Optional: the period's average monthly income from project
            // (non-subscription) invoices.
            let averageProjectIncome = 0;
            if (includeAverage && payments.length) {
                const invSubs = await Invoice.find({ _id: { $in: payments.map((p) => p.invoice) } }).select('subscription').lean();
                const fromSub = new Set(invSubs.filter((i) => i.subscription).map((i) => String(i._id)));
                const projectTotal = payments
                    .filter((p) => !fromSub.has(String(p.invoice)))
                    .reduce((t, p) => t + convLocked(p, p.amount, p.currency, p.paidAt), 0);
                averageProjectIncome = projectTotal / months;
                rows.forEach((r) => { r.average = averageProjectIncome; });
            }

            expenseCharges(fFrom, fTo).forEach(({ e, d }) => { const r = fKey[monthKey(d)]; if (r) r.expenses += cnow(e.amount, e.currency); });
            rows.forEach((r) => {
                team.forEach((m) => { r.salaries += cnow(salaryFor(m, r.start), m.currency); });
                r.income = r.subscriptions + r.invoices + r.average;
                r.costs = r.expenses + r.salaries;
                r.profit = r.income - r.costs;
                delete r.start;
            });
            const ft = {};
            ['subscriptions', 'invoices', 'average', 'income', 'expenses', 'salaries', 'costs', 'profit'].forEach((k) => { ft[k] = sum(rows, k); });
            forecast = { months: forecastMonths, includeAverage, averageProjectIncome, series: rows, totals: ft };
        }

        res.json({
            success: true,
            data: {
                currency,
                usedCurrencies: [...usedCurrencies],
                fx: latest ? { source: latest.source, asOf: latest.asOf, fetchedAt: latest.fetchedAt, stale: !!latest.stale, used: needsFx } : null,
                unconverted: [...unconverted],
                range: { from: monthKey(from), to: monthKey(to), months, endsThisMonth: monthKey(to) === thisKey },
                series,
                totals,
                runRate: {
                    subscriptions: monthlySubscriptions,
                    salaries: monthlySalaries,
                    total: monthlySubscriptions + monthlySalaries,
                    activeSubscriptions: activeRecurring.length,
                    activeMembers: team.filter((m) => salaryFor(m, thisMonth) > 0).length,
                },
                byCategory: Object.entries(byCategory).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
                upcoming,
                forecast,
            },
        });
    } catch (error) {
        fail(res, 500, 'Error building finance overview', error);
    }
};

// GET /api/finance/fx/rates[?refresh=1] — today's rates (per 1 USD) for the
// converter and the dashboard's own conversions.
const getFxRates = async (req, res) => {
    try {
        const cached = await fx.getLatest();
        // A manual refresh is allowed once the cached copy is 10+ minutes old.
        const latest = req.query.refresh === '1' && Date.now() - new Date(cached.fetchedAt).getTime() > 10 * 60 * 1000
            ? await fx.getLatest({ force: true })
            : cached;
        res.json({ success: true, data: { base: 'USD', rates: latest.rates, source: latest.source, asOf: latest.asOf, fetchedAt: latest.fetchedAt, stale: !!latest.stale } });
    } catch (error) {
        fail(res, 502, 'Exchange rates are unavailable right now', error);
    }
};

module.exports = {
    listExpenses, createExpense, updateExpense, deleteExpense,
    listTeam, listTeamAccounts, createMember, updateMember, deleteMember,
    getOverview, getFxRates,
    // exported for tests
    chargesBetween, salaryFor, subscriptionIncome,
};
