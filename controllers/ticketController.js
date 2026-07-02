const Ticket = require('../models/Ticket');

// ── Admin/staff side ────────────────────────────────────────────────────────

const getAllTickets = async (req, res) => {
    try {
        const { company, status, priority, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (company) filter.company = company;
        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        const skip = (page - 1) * limit;
        const [tickets, total] = await Promise.all([
            Ticket.find(filter)
                .populate('company', 'name logo')
                .populate('assignedTo', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Ticket.countDocuments(filter),
        ]);

        res.json({
            success: true,
            data: tickets,
            pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / limit), total, limit: parseInt(limit) },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching tickets', error: error.message });
    }
};

const getTicketById = async (req, res) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
            .populate('company', 'name logo')
            .populate('assignedTo', 'name');
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
        res.json({ success: true, data: ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching ticket', error: error.message });
    }
};

const updateTicket = async (req, res) => {
    try {
        const ticket = await Ticket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
        ['status', 'priority', 'category', 'assignedTo'].forEach((f) => { if (req.body[f] !== undefined) ticket[f] = req.body[f]; });
        await ticket.save();
        res.json({ success: true, message: 'Ticket updated', data: ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating ticket', error: error.message });
    }
};

// Staff reply on a ticket.
const replyTicket = async (req, res) => {
    try {
        const ticket = await Ticket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
        const { text } = req.body;
        const attachments = (req.files || []).map((f) => ({ url: f.path, publicId: f.filename, type: f.mimetype, name: f.originalname }));
        if (!text && !attachments.length) return res.status(400).json({ success: false, message: 'Message text or attachment required' });
        ticket.messages.push({ authorType: 'staff', authorId: req.user?._id, authorName: req.user?.name || 'Arixy', text: text || '', attachments });
        if (ticket.status === 'open') ticket.status = 'in-progress';
        await ticket.save();
        res.json({ success: true, message: 'Reply added', data: ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error replying', error: error.message });
    }
};

const deleteTicket = async (req, res) => {
    try {
        const ticket = await Ticket.findByIdAndDelete(req.params.id);
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
        res.json({ success: true, message: 'Ticket deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting ticket', error: error.message });
    }
};

module.exports = { getAllTickets, getTicketById, updateTicket, replyTicket, deleteTicket };
