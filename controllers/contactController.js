const Contact = require('../models/Contact');

// Create a new contact inquiry
const createContact = async (req, res) => {
    try {
        const { name, email, phoneNumber, companyName, subject, message } = req.body;

        // Validate required fields
        if (!name || !email || !companyName || !message) {
            return res.status(400).json({
                success: false,
                message: 'Please fill in all required fields: name, email, company name, and message'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address'
            });
        }

        const newContact = new Contact({
            name,
            email,
            phoneNumber,
            companyName,
            subject,
            message
        });

        const savedContact = await newContact.save();

        res.status(201).json({
            success: true,
            message: 'Contact inquiry submitted successfully',
            data: savedContact
        });

    } catch (error) {
        console.error('Error creating contact:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get all contact inquiries with pagination and filtering
const getContacts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status;
        const priority = req.query.priority;
        const search = req.query.search;

        const query = {};

        // Add filters
        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { companyName: { $regex: search, $options: 'i' } },
                { subject: { $regex: search, $options: 'i' } }
            ];
        }

        const totalContacts = await Contact.countDocuments(query);
        const contacts = await Contact.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        res.status(200).json({
            success: true,
            data: contacts,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalContacts / limit),
                totalContacts,
                limit
            }
        });

    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get a single contact by ID
const getContactById = async (req, res) => {
    try {
        const contact = await Contact.findById(req.params.id);

        if (!contact) {
            return res.status(404).json({
                success: false,
                message: 'Contact not found'
            });
        }

        res.status(200).json({
            success: true,
            data: contact
        });

    } catch (error) {
        console.error('Error fetching contact:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Update contact status, priority, or notes
const updateContact = async (req, res) => {
    try {
        const { status, priority, notes, contactedAt } = req.body;
        const contactId = req.params.id;

        const updateData = {};
        if (status) updateData.status = status;
        if (priority) updateData.priority = priority;
        if (notes !== undefined) updateData.notes = notes;
        if (contactedAt) updateData.contactedAt = contactedAt;

        const updatedContact = await Contact.findByIdAndUpdate(
            contactId,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedContact) {
            return res.status(404).json({
                success: false,
                message: 'Contact not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Contact updated successfully',
            data: updatedContact
        });

    } catch (error) {
        console.error('Error updating contact:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Delete a contact
const deleteContact = async (req, res) => {
    try {
        const deletedContact = await Contact.findByIdAndDelete(req.params.id);

        if (!deletedContact) {
            return res.status(404).json({
                success: false,
                message: 'Contact not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Contact deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get contact statistics
const getContactStats = async (req, res) => {
    try {
        const totalContacts = await Contact.countDocuments();
        const newContacts = await Contact.countDocuments({ status: 'new' });
        const contactedContacts = await Contact.countDocuments({ status: 'contacted' });
        const convertedContacts = await Contact.countDocuments({ status: 'converted' });
        const closedContacts = await Contact.countDocuments({ status: 'closed' });

        const priorityStats = await Contact.aggregate([
            {
                $group: {
                    _id: '$priority',
                    count: { $sum: 1 }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: {
                total: totalContacts,
                byStatus: {
                    new: newContacts,
                    contacted: contactedContacts,
                    converted: convertedContacts,
                    closed: closedContacts
                },
                byPriority: priorityStats.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {})
            }
        });

    } catch (error) {
        console.error('Error fetching contact stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

module.exports = {
    createContact,
    getContacts,
    getContactById,
    updateContact,
    deleteContact,
    getContactStats
};
