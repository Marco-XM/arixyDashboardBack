const Service = require('../models/Service');

const getAllServices = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = {};
        if (status) filter.status = status;
        const services = await Service.find(filter).sort({ createdAt: -1 });
        res.json({ success: true, data: services });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching services', error: error.message });
    }
};

const createService = async (req, res) => {
    try {
        const { name, name_ar, description, category, defaultFee, currency, billingCycle, status } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Service name is required' });
        const service = new Service({
            name: name.trim(), name_ar: name_ar || '', description: description || '', category: category || '',
            defaultFee: Number(defaultFee || 0), currency: currency || 'USD', billingCycle: billingCycle || 'monthly',
            status: status || 'active',
        });
        await service.save();
        res.status(201).json({ success: true, message: 'Service created', data: service });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating service', error: error.message });
    }
};

const updateService = async (req, res) => {
    try {
        const service = await Service.findById(req.params.id);
        if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
        ['name', 'name_ar', 'description', 'category', 'defaultFee', 'currency', 'billingCycle', 'status'].forEach((f) => {
            if (req.body[f] !== undefined) service[f] = req.body[f];
        });
        await service.save();
        res.json({ success: true, message: 'Service updated', data: service });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating service', error: error.message });
    }
};

const deleteService = async (req, res) => {
    try {
        const service = await Service.findByIdAndDelete(req.params.id);
        if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
        res.json({ success: true, message: 'Service deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting service', error: error.message });
    }
};

module.exports = { getAllServices, createService, updateService, deleteService };
