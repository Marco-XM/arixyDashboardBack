const Company = require('../models/Company');
const CompanyUser = require('../models/CompanyUser');
const { cloudinary } = require('./cloudinary');

/* -------------------------------------------------------------------------- */
/*  Companies (admin/staff side)                                              */
/* -------------------------------------------------------------------------- */

// Get all companies (paginated) with a staff-user count for each.
const getAllCompanies = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, search } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { contactEmail: { $regex: search, $options: 'i' } },
                { industry: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (page - 1) * limit;

        const [companies, total] = await Promise.all([
            Company.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Company.countDocuments(filter)
        ]);

        // Attach a user count to each company without N+1 queries.
        const ids = companies.map((c) => c._id);
        const counts = await CompanyUser.aggregate([
            { $match: { company: { $in: ids } } },
            { $group: { _id: '$company', count: { $sum: 1 } } }
        ]);
        const countMap = counts.reduce((m, c) => { m[c._id.toString()] = c.count; return m; }, {});
        const data = companies.map((c) => ({
            ...c.toObject(),
            userCount: countMap[c._id.toString()] || 0
        }));

        res.json({
            success: true,
            data,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalCompanies: total,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Error fetching companies:', error);
        res.status(500).json({ success: false, message: 'Error fetching companies', error: error.message });
    }
};

const getCompanyById = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        res.json({ success: true, data: company });
    } catch (error) {
        console.error('Error fetching company:', error);
        res.status(500).json({ success: false, message: 'Error fetching company', error: error.message });
    }
};

const createCompany = async (req, res) => {
    try {
        const { name, contactEmail, phone, address, website, industry, status, notes } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Company name is required' });
        }

        const company = new Company({
            name: name.trim(),
            contactEmail: contactEmail?.trim(),
            phone: phone?.trim(),
            address: address?.trim(),
            website: website?.trim(),
            industry: industry?.trim(),
            status: status || 'active',
            notes: notes?.trim(),
            logo: req.file?.path,
            cloudinaryId: req.file?.filename
        });

        await company.save();
        res.status(201).json({ success: true, message: 'Company created successfully', data: company });
    } catch (error) {
        console.error('Error creating company:', error);
        res.status(500).json({ success: false, message: 'Error creating company', error: error.message });
    }
};

const updateCompany = async (req, res) => {
    try {
        const { name, contactEmail, phone, address, website, industry, status, notes } = req.body;
        const company = await Company.findById(req.params.id);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        if (name) company.name = name.trim();
        if (contactEmail !== undefined) company.contactEmail = contactEmail?.trim();
        if (phone !== undefined) company.phone = phone?.trim();
        if (address !== undefined) company.address = address?.trim();
        if (website !== undefined) company.website = website?.trim();
        if (industry !== undefined) company.industry = industry?.trim();
        if (status) company.status = status;
        if (notes !== undefined) company.notes = notes?.trim();

        if (req.file) {
            if (company.cloudinaryId) {
                await cloudinary.uploader.destroy(company.cloudinaryId);
            }
            company.logo = req.file.path;
            company.cloudinaryId = req.file.filename;
        }

        await company.save();
        res.json({ success: true, message: 'Company updated successfully', data: company });
    } catch (error) {
        console.error('Error updating company:', error);
        res.status(500).json({ success: false, message: 'Error updating company', error: error.message });
    }
};

const deleteCompany = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        if (company.cloudinaryId) {
            await cloudinary.uploader.destroy(company.cloudinaryId);
        }

        // Cascade: remove the company's staff accounts.
        await CompanyUser.deleteMany({ company: company._id });
        await Company.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: 'Company deleted successfully' });
    } catch (error) {
        console.error('Error deleting company:', error);
        res.status(500).json({ success: false, message: 'Error deleting company', error: error.message });
    }
};

const getCompanyStats = async (req, res) => {
    try {
        const [activeCount, inactiveCount, totalCount] = await Promise.all([
            Company.countDocuments({ status: 'active' }),
            Company.countDocuments({ status: 'inactive' }),
            Company.countDocuments()
        ]);
        res.json({ success: true, data: { activeCount, inactiveCount, totalCount } });
    } catch (error) {
        console.error('Error fetching company stats:', error);
        res.status(500).json({ success: false, message: 'Error fetching company stats', error: error.message });
    }
};

/* -------------------------------------------------------------------------- */
/*  Company staff users (managed by admin/staff)                              */
/* -------------------------------------------------------------------------- */

const getCompanyUsers = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        const users = await CompanyUser.find({ company: company._id })
            .select('-password')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Error fetching company users:', error);
        res.status(500).json({ success: false, message: 'Error fetching company users', error: error.message });
    }
};

const createCompanyUser = async (req, res) => {
    try {
        const { name, username, email, password, role, status } = req.body;

        const company = await Company.findById(req.params.id);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        if (!name || !username || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, username, email and password are required' });
        }

        const user = new CompanyUser({
            company: company._id,
            name: name.trim(),
            username: username.trim(),
            email: email.trim().toLowerCase(),
            password,
            role: role || 'member',
            status: status || 'active'
        });

        await user.save();
        const out = user.toObject();
        delete out.password;
        res.status(201).json({ success: true, message: 'Company user created successfully', data: out });
    } catch (error) {
        console.error('Error creating company user:', error);
        // Surface duplicate username/email cleanly.
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'A user with that username or email already exists' });
        }
        res.status(500).json({ success: false, message: 'Error creating company user', error: error.message });
    }
};

const updateCompanyUser = async (req, res) => {
    try {
        const { name, role, status, password } = req.body;
        const user = await CompanyUser.findOne({ _id: req.params.userId, company: req.params.id });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Company user not found' });
        }

        if (name) user.name = name.trim();
        if (role) user.role = role;
        if (status) user.status = status;
        if (password) user.password = password; // pre('save') re-hashes

        await user.save();
        const out = user.toObject();
        delete out.password;
        res.json({ success: true, message: 'Company user updated successfully', data: out });
    } catch (error) {
        console.error('Error updating company user:', error);
        res.status(500).json({ success: false, message: 'Error updating company user', error: error.message });
    }
};

const deleteCompanyUser = async (req, res) => {
    try {
        const user = await CompanyUser.findOneAndDelete({ _id: req.params.userId, company: req.params.id });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Company user not found' });
        }
        res.json({ success: true, message: 'Company user deleted successfully' });
    } catch (error) {
        console.error('Error deleting company user:', error);
        res.status(500).json({ success: false, message: 'Error deleting company user', error: error.message });
    }
};

module.exports = {
    getAllCompanies,
    getCompanyById,
    createCompany,
    updateCompany,
    deleteCompany,
    getCompanyStats,
    getCompanyUsers,
    createCompanyUser,
    updateCompanyUser,
    deleteCompanyUser
};
