const ContractTemplate = require('../models/ContractTemplate');

const getAllTemplates = async (req, res) => {
    try {
        const { category } = req.query;
        const filter = {};
        if (category && category !== 'all') filter.$or = [{ category }, { category: 'all' }];
        const templates = await ContractTemplate.find(filter).sort({ createdAt: -1 });
        res.json({ success: true, data: templates });
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ success: false, message: 'Error fetching templates', error: error.message });
    }
};

const getTemplateById = async (req, res) => {
    try {
        const template = await ContractTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
        res.json({ success: true, data: template });
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({ success: false, message: 'Error fetching template', error: error.message });
    }
};

const getDefaultTemplate = async (req, res) => {
    try {
        const { category } = req.query;
        const template = await ContractTemplate.findOne({ isDefault: true, ...(category ? { category } : {}) })
            || await ContractTemplate.findOne({ isDefault: true });
        res.json({ success: true, data: template || null });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching default template', error: error.message });
    }
};

const createTemplate = async (req, res) => {
    try {
        const { name, description, headerText, customSections, category, isDefault } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Template name is required' });

        const template = new ContractTemplate({
            name: name.trim(),
            description: description || '',
            headerText: headerText || '',
            customSections: Array.isArray(customSections) ? customSections : [],
            category: category || 'all',
            isDefault: !!isDefault,
            createdBy: req.user?._id,
        });
        await template.save();
        res.status(201).json({ success: true, message: 'Template created', data: template });
    } catch (error) {
        console.error('Error creating template:', error);
        if (error.code === 11000) return res.status(400).json({ success: false, message: 'A template with that name already exists' });
        res.status(500).json({ success: false, message: 'Error creating template', error: error.message });
    }
};

const updateTemplate = async (req, res) => {
    try {
        const { name, description, headerText, customSections, category, isDefault } = req.body;
        const template = await ContractTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

        if (name !== undefined) template.name = name.trim();
        if (description !== undefined) template.description = description;
        if (headerText !== undefined) template.headerText = headerText;
        if (customSections !== undefined) template.customSections = Array.isArray(customSections) ? customSections : [];
        if (category !== undefined) template.category = category;
        if (isDefault !== undefined) template.isDefault = !!isDefault;

        await template.save();
        res.json({ success: true, message: 'Template updated', data: template });
    } catch (error) {
        console.error('Error updating template:', error);
        if (error.code === 11000) return res.status(400).json({ success: false, message: 'A template with that name already exists' });
        res.status(500).json({ success: false, message: 'Error updating template', error: error.message });
    }
};

const setDefaultTemplate = async (req, res) => {
    try {
        const template = await ContractTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
        template.isDefault = true;
        await template.save(); // pre-save clears other defaults in the same category
        res.json({ success: true, message: 'Default template set', data: template });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error setting default template', error: error.message });
    }
};

const deleteTemplate = async (req, res) => {
    try {
        const template = await ContractTemplate.findByIdAndDelete(req.params.id);
        if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting template', error: error.message });
    }
};

module.exports = {
    getAllTemplates,
    getTemplateById,
    getDefaultTemplate,
    createTemplate,
    updateTemplate,
    setDefaultTemplate,
    deleteTemplate,
};
