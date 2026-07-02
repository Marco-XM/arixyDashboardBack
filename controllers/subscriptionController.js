const Subscription = require('../models/Subscription');
const Service = require('../models/Service');

const getAllSubscriptions = async (req, res) => {
    try {
        const { company, status } = req.query;
        const filter = {};
        if (company) filter.company = company;
        if (status) filter.status = status;
        const subs = await Subscription.find(filter)
            .populate('company', 'name')
            .populate('service', 'name')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: subs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching subscriptions', error: error.message });
    }
};

const createSubscription = async (req, res) => {
    try {
        const { company, service, price, billingCycle, startDate, endDate, status, notes } = req.body;
        if (!company || !service) return res.status(400).json({ success: false, message: 'Company and service are required' });

        const svc = await Service.findById(service);
        const sub = new Subscription({
            company, service,
            serviceName: svc?.name || '',
            price: {
                amount: price?.amount != null ? Number(price.amount) : (svc?.defaultFee || 0),
                currency: price?.currency || svc?.currency || 'USD',
            },
            billingCycle: billingCycle || svc?.billingCycle || 'monthly',
            startDate: startDate || undefined, endDate: endDate || undefined,
            status: status || 'active', notes: notes || '',
        });
        await sub.save();
        res.status(201).json({ success: true, message: 'Subscription created', data: sub });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating subscription', error: error.message });
    }
};

const updateSubscription = async (req, res) => {
    try {
        const sub = await Subscription.findById(req.params.id);
        if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
        ['price', 'billingCycle', 'startDate', 'endDate', 'status', 'notes'].forEach((f) => {
            if (req.body[f] !== undefined) sub[f] = req.body[f];
        });
        await sub.save();
        res.json({ success: true, message: 'Subscription updated', data: sub });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating subscription', error: error.message });
    }
};

const deleteSubscription = async (req, res) => {
    try {
        const sub = await Subscription.findByIdAndDelete(req.params.id);
        if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
        res.json({ success: true, message: 'Subscription deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting subscription', error: error.message });
    }
};

module.exports = { getAllSubscriptions, createSubscription, updateSubscription, deleteSubscription };
