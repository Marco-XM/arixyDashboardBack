const Client = require('../models/Client');
const { cloudinary } = require('./cloudinary');

// Get all clients
const getAllClients = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, search } = req.query;
        
        // Build filter object
        const filter = {};
        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        
        // Execute queries
        const [clients, total] = await Promise.all([
            Client.find(filter)
                .sort({ displayOrder: 1, createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Client.countDocuments(filter)
        ]);

        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: clients,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalClients: total,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching clients',
            error: error.message
        });
    }
};

// Get client by ID
const getClientById = async (req, res) => {
    try {
        const client = await Client.findById(req.params.id);
        
        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        res.json({
            success: true,
            data: client
        });
    } catch (error) {
        console.error('Error fetching client:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching client',
            error: error.message
        });
    }
};

// Create new client
const createClient = async (req, res) => {
    try {
        const { name, website, description, status, displayOrder } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Client name is required'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Logo image is required'
            });
        }

        // File is automatically uploaded to Cloudinary via CloudinaryStorage (same as cardController)
        const logo = req.file?.path; // Cloudinary URL
        
        // Create client
        const client = new Client({
            name: name.trim(),
            logo: logo,
            cloudinaryId: req.file?.filename, // Cloudinary public_id
            website: website?.trim(),
            description: description?.trim(),
            status: status || 'active',
            displayOrder: displayOrder || 0
        });

        await client.save();

        res.status(201).json({
            success: true,
            message: 'Client created successfully',
            data: client
        });
    } catch (error) {
        console.error('Error creating client:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating client',
            error: error.message
        });
    }
};

// Update client
const updateClient = async (req, res) => {
    try {
        const { name, website, description, status, displayOrder } = req.body;
        const client = await Client.findById(req.params.id);

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Update fields
        if (name) client.name = name.trim();
        if (website !== undefined) client.website = website?.trim();
        if (description !== undefined) client.description = description?.trim();
        if (status) client.status = status;
        if (displayOrder !== undefined) client.displayOrder = displayOrder;

        // Handle logo update (same method as cardController)
        if (req.file) {
            // Delete old image from Cloudinary if exists
            if (client.cloudinaryId) {
                await cloudinary.uploader.destroy(client.cloudinaryId);
            }

            // File is automatically uploaded to Cloudinary via CloudinaryStorage
            client.logo = req.file.path; // Cloudinary URL
            client.cloudinaryId = req.file.filename; // Cloudinary public_id
        }

        await client.save();

        res.json({
            success: true,
            message: 'Client updated successfully',
            data: client
        });
    } catch (error) {
        console.error('Error updating client:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating client',
            error: error.message
        });
    }
};

// Delete client
const deleteClient = async (req, res) => {
    try {
        const client = await Client.findById(req.params.id);

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Delete image from Cloudinary
        if (client.cloudinaryId) {
            await cloudinary.uploader.destroy(client.cloudinaryId);
        }

        await Client.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Client deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting client',
            error: error.message
        });
    }
};

// Get client stats
const getClientStats = async (req, res) => {
    try {
        const [activeCount, inactiveCount, totalCount] = await Promise.all([
            Client.countDocuments({ status: 'active' }),
            Client.countDocuments({ status: 'inactive' }),
            Client.countDocuments()
        ]);

        res.json({
            success: true,
            data: {
                activeCount,
                inactiveCount,
                totalCount
            }
        });
    } catch (error) {
        console.error('Error fetching client stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching client stats',
            error: error.message
        });
    }
};

// Get active clients (for public display)
const getActiveClients = async (req, res) => {
    try {
        const clients = await Client.find({ status: 'active' })
            .sort({ displayOrder: 1, createdAt: -1 })
            .select('name logo website description displayOrder');

        res.json({
            success: true,
            data: clients
        });
    } catch (error) {
        console.error('Error fetching active clients:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching active clients',
            error: error.message
        });
    }
};

module.exports = {
    getAllClients,
    getClientById,
    createClient,
    updateClient,
    deleteClient,
    getClientStats,
    getActiveClients
};
