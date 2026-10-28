const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const TeamMember = require('../models/TeamMember');
const Admin = require('../models/Admin');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
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

const createExpense = async (req, res) => {
    try {
        const input = sanitizeExpense(req.body);
        if (!input.title) return fail(res, 400, 'A name is required');
        if (input.amount === undefined) return fail(res, 400, 'An amount is required');
        const expense = await Expense.create({ ...input, createdBy: req.user?._id });
        res.status(201).json({ success: true, message: 'Expense added', data: expense });
    } catch (error) {
        fail(res, 500, 'Error adding expense', error);
    }
};

const updateExpense = async (req, res) => {
    try {
        const input = sanitizeExpense(req.body);
        if (input.title === '') return fail(res, 400, 'A name is required');
        const expense = await Expense.findByIdAndUpdate(req.params.id, { $set: input }, { new: true, runValidators: true });
        if (!expense) return fail(res, 404, 'Expense not found');
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

// GET /api/finance/overview?currency=EGP&months=12 — revenue vs costs per
// month (cash basis: payments received vs expenses charged + salaries).
// Every amount, whatever its currency, is converted into `currency` at the
// exchange rate of the month it falls in (utils/fx.js).
const getOverview = async (req, res) => {
    try {
        const currency = str(req.query.currency, 8).toUpperCase() || 'EGP';
        const months = Math.min(36, Math.max(1, num(req.query.months, 12)));

        const now = new Date();
        const thisMonth = monthStart(now);
        const thisKey = monthKey(thisMonth);
        const from = addMonths(thisMonth, -(months - 1));
        const to = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() + 1, 1) - 1);

        const series = [];
        for (let i = 0; i < months; i += 1) {
            const m = addMonths(from, i);
            series.push({ month: monthKey(m), start: m, collected: 0, invoiced: 0, expenses: 0, salaries: 0 });
        }
        const byKey = Object.fromEntries(series.map((s) => [s.month, s]));

        const [payments, invoices, expenses, team, latest] = await Promise.all([
            Payment.find({ paidAt: { $gte: from, $lte: to } }).select('amount currency paidAt').lean(),
            Invoice.find({ status: { $nin: ['draft', 'void'] }, issueDate: { $gte: from, $lte: to } }).select('total currency issueDate').lean(),
            Expense.find().lean(),
            TeamMember.find().lean(),
            fx.getLatest().catch((err) => { console.warn('FX unavailable:', err.message); return null; }),
        ]);

        // Month rates are only needed when some amount is in another currency.
        const usedCurrencies = new Set([...payments, ...invoices, ...expenses, ...team].map((x) => String(x.currency || '').toUpperCase()).filter(Boolean));
        const needsFx = [...usedCurrencies].some((c) => c !== currency);
        const monthRates = {};
        if (needsFx) {
            await Promise.all(series.map(async (s) => {
                monthRates[s.month] = s.month === thisKey ? latest : await fx.getMonth(s.month).catch(() => latest);
            }));
        }
        const unconverted = new Set();
        const conv = (amount, cur, key) => {
            const c = String(cur || currency).toUpperCase();
            if (c === currency) return Number(amount || 0);
            const v = fx.convert(amount, c, currency, (monthRates[key] || latest)?.rates);
            if (v === null) { unconverted.add(c); return 0; }
            return v;
        };

        payments.forEach((p) => { const k = monthKey(new Date(p.paidAt)); const s = byKey[k]; if (s) s.collected += conv(p.amount, p.currency, k); });
        invoices.forEach((inv) => { const k = monthKey(new Date(inv.issueDate)); const s = byKey[k]; if (s) s.invoiced += conv(inv.total, inv.currency, k); });

        const byCategory = {};
        const addCategory = (cat, amount) => { byCategory[cat] = (byCategory[cat] || 0) + amount; };
        expenses.forEach((e) => {
            const dates = e.kind === 'recurring'
                ? chargesBetween(e, from, to)
                : (new Date(e.date) >= from && new Date(e.date) <= to ? [new Date(e.date)] : []);
            dates.forEach((d) => {
                const k = monthKey(d);
                const s = byKey[k];
                if (!s) return;
                const v = conv(e.amount, e.currency, k);
                s.expenses += v;
                addCategory(e.category || 'Other', v);
            });
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

        const sum = (k) => series.reduce((t, s) => t + s[k], 0);
        const totals = {
            collected: sum('collected'), invoiced: sum('invoiced'),
            expenses: sum('expenses'), salaries: sum('salaries'), costs: sum('costs'),
        };
        totals.profit = totals.collected - totals.costs;
        totals.margin = totals.collected > 0 ? totals.profit / totals.collected : null;

        // What the business costs to run each month right now (today's rates).
        const activeRecurring = expenses.filter((e) => e.kind === 'recurring' && new Date(e.date) <= now && (!e.endDate || new Date(e.endDate) >= now));
        const monthlySubscriptions = activeRecurring.reduce((t, e) => t + conv(e.amount / (CYCLE_MONTHS[e.billingCycle] || 1), e.currency, thisKey), 0);
        const monthlySalaries = team.reduce((t, m) => t + conv(salaryFor(m, thisMonth), m.currency, thisKey), 0);

        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const soon = new Date(today.getTime() + 30 * 86400000);
        const upcoming = expenses
            .filter((e) => e.kind === 'recurring')
            .map((e) => ({
                _id: e._id, title: e.title, vendor: e.vendor, billingCycle: e.billingCycle, next: nextCharge(e, today),
                amount: conv(e.amount, e.currency, thisKey), originalAmount: e.amount, originalCurrency: e.currency,
            }))
            .filter((e) => e.next && e.next <= soon)
            .sort((a, b) => a.next - b.next);

        res.json({
            success: true,
            data: {
                currency,
                usedCurrencies: [...usedCurrencies],
                fx: latest ? { source: latest.source, asOf: latest.asOf, fetchedAt: latest.fetchedAt, stale: !!latest.stale, used: needsFx } : null,
                unconverted: [...unconverted],
                range: { from, to },
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
    chargesBetween, salaryFor,
};
