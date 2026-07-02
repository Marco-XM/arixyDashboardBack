const Document = require('../models/Document');
const Company = require('../models/Company');
const Subscription = require('../models/Subscription');
const Service = require('../models/Service');
const ContractTemplate = require('../models/ContractTemplate');
const { renderTemplateToPdfBuffer, renderPageTemplateToPdf } = require('../utils/htmlPdfRenderer');
const { uploadRawBuffer, cloudinary } = require('./cloudinary');

// Assemble the render context (company/subscription/service/document + data)
// for a given document document instance.
async function buildContext(doc) {
    const company = doc.company && doc.company.name ? doc.company : await Company.findById(doc.company);
    let subscription = null;
    let service = null;
    if (doc.subscription) {
        subscription = doc.subscription && doc.subscription.service ? doc.subscription : await Subscription.findById(doc.subscription);
        if (subscription?.service) service = await Service.findById(subscription.service);
    }
    return {
        data: doc.data || {},
        company: company || {},
        subscription: subscription || null,
        service: service || null,
        document: {
            title: doc.title,
            number: doc.number,
            issueDate: doc.issueDate,
            createdAt: doc.createdAt,
            period: doc.period,
        },
    };
}

const getAllDocuments = async (req, res) => {
    try {
        const { company, type, status, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (company) filter.company = company;
        if (type) filter.type = type;
        if (status) filter.status = status;

        const skip = (page - 1) * limit;
        const [documents, total] = await Promise.all([
            Document.find(filter)
                .populate('company', 'name logo')
                .populate('template', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Document.countDocuments(filter),
        ]);

        res.json({
            success: true,
            data: documents,
            pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / limit), total, limit: parseInt(limit) },
        });
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ success: false, message: 'Error fetching documents', error: error.message });
    }
};

const getDocumentById = async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id)
            .populate('company', 'name logo')
            .populate('template', 'name customSections headerText')
            .populate('subscription');
        if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
        res.json({ success: true, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching document', error: error.message });
    }
};

const createDocument = async (req, res) => {
    try {
        const { type, title, number, company, subscription, template, data, period, status, issueDate } = req.body;
        if (!type || !title || !company) {
            return res.status(400).json({ success: false, message: 'type, title and company are required' });
        }
        const doc = new Document({
            type, title: title.trim(), number, company,
            subscription: subscription || undefined,
            template: template || undefined,
            data: data || {},
            period: period || undefined,
            status: status || 'draft',
            issueDate: issueDate || undefined,
            createdBy: req.user?._id,
        });
        await doc.save();
        res.status(201).json({ success: true, message: 'Document created', data: doc });
    } catch (error) {
        console.error('Error creating document:', error);
        res.status(500).json({ success: false, message: 'Error creating document', error: error.message });
    }
};

const updateDocument = async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

        const fields = ['type', 'title', 'number', 'company', 'subscription', 'template', 'data', 'period', 'status', 'issueDate'];
        fields.forEach((f) => { if (req.body[f] !== undefined) doc[f] = req.body[f]; });
        await doc.save();
        res.json({ success: true, message: 'Document updated', data: doc });
    } catch (error) {
        console.error('Error updating document:', error);
        res.status(500).json({ success: false, message: 'Error updating document', error: error.message });
    }
};

const deleteDocument = async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
        if (doc.pdfPublicId) {
            try { await cloudinary.uploader.destroy(doc.pdfPublicId, { resource_type: 'raw' }); } catch (e) { /* ignore */ }
        }
        await Document.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting document', error: error.message });
    }
};

// Render the document's PDF, upload to Cloudinary, and store the URL.
const generatePdf = async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

        const template = doc.template ? await ContractTemplate.findById(doc.template) : null;
        if (!template) return res.status(400).json({ success: false, message: 'Document has no template to render' });

        const context = await buildContext(doc);
        // Page/block templates (rich editor) render via the page renderer;
        // legacy customSections templates use the section renderer.
        const buffer = (Array.isArray(template.pages) && template.pages.length)
            ? await renderPageTemplateToPdf(context, { pages: template.pages, headerText: template.headerText })
            : await renderTemplateToPdfBuffer(template, context);

        // Replace the previous PDF if any.
        if (doc.pdfPublicId) {
            try { await cloudinary.uploader.destroy(doc.pdfPublicId, { resource_type: 'raw' }); } catch (e) { /* ignore */ }
        }
        const { url, publicId } = await uploadRawBuffer(buffer, {
            folder: 'documents',
            publicId: `doc_${doc._id}_${Date.now()}`,
        });

        doc.pdfUrl = url;
        doc.pdfPublicId = publicId;
        doc.generatedAt = new Date();
        if (doc.status === 'draft') doc.status = 'issued';
        await doc.save();

        res.json({ success: true, message: 'PDF generated', data: { pdfUrl: url, document: doc } });
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ success: false, message: 'Error generating PDF', error: error.message });
    }
};

// Live preview: render an ad-hoc template + data (not persisted) and stream the
// PDF inline. Powers the template editor and the document builder preview.
const previewPdf = async (req, res) => {
    try {
        const { template, data = {}, company: companyId } = req.body;
        if (!template || !Array.isArray(template.customSections)) {
            return res.status(400).json({ success: false, message: 'A template with customSections is required' });
        }
        let company = {};
        if (companyId) company = (await Company.findById(companyId)) || {};

        const context = {
            data,
            company,
            subscription: null,
            service: null,
            document: { title: data.__title || 'Preview', number: data.contractNumber, period: data.__period },
        };
        const buffer = await renderTemplateToPdfBuffer(template, context);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
        res.send(buffer);
    } catch (error) {
        console.error('Error rendering preview:', error);
        res.status(500).json({ success: false, message: 'Error rendering preview', error: error.message });
    }
};

// Sample data so blank previews show realistic content.
function samplePreviewContext(company) {
    const now = new Date();
    return {
        data: {
            contractNumber: '#PREVIEW-001',
            serviceName: 'Website Maintenance',
            servicePrice: '1500 USD',
            billingCycle: 'monthly',
            lineItems: [
                { description: 'Website maintenance', quantity: 1, unitPrice: 3000, currency: 'USD' },
                { description: 'SEO retainer', quantity: 1, unitPrice: 1500, currency: 'USD' },
            ],
            signatures: [{ name: 'Authorized Signatory' }],
        },
        company: company && company.name ? company : {
            name: 'Sample Company LLC', contactEmail: 'client@example.com', phone: '+20 100 000 0000',
            address: '123 Main St, Cairo', website: 'https://example.com', industry: 'Manufacturing',
        },
        subscription: null,
        service: null,
        document: { title: 'Preview', number: '#PREVIEW-001', issueDate: now, createdAt: now, period: { month: now.getMonth() + 1, year: now.getFullYear() } },
    };
}

// Stream a document's PDF inline by re-rendering it. Avoids relying on
// Cloudinary's public PDF delivery (which is blocked by default → 401).
const viewDocument = async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
        const template = doc.template ? await ContractTemplate.findById(doc.template) : null;
        if (!template) return res.status(400).json({ success: false, message: 'Document has no template to render' });

        const context = await buildContext(doc);
        const buffer = (Array.isArray(template.pages) && template.pages.length)
            ? await renderPageTemplateToPdf(context, { pages: template.pages, headerText: template.headerText })
            : await renderTemplateToPdfBuffer(template, context);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${(doc.title || 'document').replace(/[^a-z0-9]/gi, '_')}.pdf"`);
        res.send(buffer);
    } catch (error) {
        console.error('Error viewing document:', error);
        res.status(500).json({ success: false, message: 'Error rendering document', error: error.message });
    }
};

// Live preview of a page/block template (not persisted). Streams PDF inline.
const previewPages = async (req, res) => {
    try {
        const { pages, headerText, company: companyId, data } = req.body;
        if (!Array.isArray(pages)) {
            return res.status(400).json({ success: false, message: 'pages array is required' });
        }
        let company = null;
        if (companyId) company = await Company.findById(companyId);
        const context = samplePreviewContext(company);
        if (data && typeof data === 'object') context.data = { ...context.data, ...data };

        const buffer = await renderPageTemplateToPdf(context, { pages, headerText });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
        res.send(buffer);
    } catch (error) {
        console.error('Error rendering page preview:', error);
        res.status(500).json({ success: false, message: 'Error rendering preview', error: error.message });
    }
};

module.exports = {
    getAllDocuments,
    getDocumentById,
    createDocument,
    updateDocument,
    deleteDocument,
    generatePdf,
    previewPdf,
    previewPages,
    viewDocument,
    buildContext,
};
