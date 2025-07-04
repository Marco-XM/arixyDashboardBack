const Admin = require('../models/Admin');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const loginAdmin = async (req, res) => {
    try {
        console.log('🔐 Admin login attempt:', req.body);
        console.log('🔑 JWT_SECRET available:', !!process.env.JWT_SECRET);
        console.log('🗄️ MongoDB URI available:', !!process.env.MONGO_URI);
        
        const { identifier, password } = req.body;
        
        if (!identifier || !password) {
            console.log('❌ Missing credentials');
            return res.status(400).send({ error: 'Identifier and password are required' });
        }
        
        console.log('👤 Looking for admin with identifier:', identifier);
        const admin = await Admin.findOne({ $or: [{ email: identifier }, { username: identifier }] });
        
        if (!admin) {
            console.log('❌ Admin not found');
            return res.status(400).send({ error: 'Invalid login credentials' });
        }
        
        console.log('✅ Admin found:', admin.username);
        const isMatch = await bcrypt.compare(password, admin.password);
        
        if (!isMatch) {
            console.log('❌ Password mismatch');
            return res.status(400).send({ error: 'Invalid login credentials' });
        }
        
        console.log('🔑 Generating token...');
        const token = jwt.sign({ _id: admin._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        
        console.log('✅ Login successful');
        res.send({ admin, token });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).send({ error: 'Internal server error', details: error.message });
    }
};

const loginUser = async (req, res) => {
    try {
        const { identifier, password } = req.body; // Use identifier instead of username
        const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] });
        if (!user) {
            return res.status(400).send({ error: 'Invalid login credentials' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).send({ error: 'Invalid login credentials' });
        }
        const token = jwt.sign({ _id: user._id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.send({ user, token });
    } catch (error) {
        res.status(400).send(error);
    }
};

const getAdmins = async (req, res) => {
    try {
        const admins = await Admin.find({ _id: { $ne: req.user._id } }).select('username name email role'); // Exclude the requesting admin
        res.send(admins);
    } catch (error) {
        res.status(500).send(error);
    }
};

const getUsers = async (req, res) => {
    try {
        const users = await User.find({});
        res.send(users);
    } catch (error) {
        res.status(500).send(error);
    }
};

const createUser = async (req, res) => {
    try {
        const { username, password, name, email, role } = req.body;
        if (!username || !password || !name || !email || !role) {
            return res.status(400).send({ error: 'Username, password, name, email, and role are required' });
        }
        
        let user;
        if (role === 'admin') {
            user = new Admin({ username, email, password, name, role });
        } else {
            user = new User({ username, password, name, email, role });
        }
        
        await user.save();
        res.status(201).send(user);
    } catch (error) {
        res.status(400).send(error);
    }
};

const deleteAdmin = async (req, res) => {
    try {
        const admin = await Admin.findByIdAndDelete(req.params.id);
        if (!admin) {
            return res.status(404).send();
        }
        res.send(admin);
    } catch (error) {
        res.status(500).send(error);
    }
};

const deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) {
            return res.status(404).send();
        }
        res.send(user);
    } catch (error) {
        res.status(500).send(error);
    }
};

const getAdminCount = async (req, res) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const count = await Admin.countDocuments({ _id: { $ne: decoded._id } });
        res.send({ count });
    } catch (error) {
        res.status(500).send(error);
    }
};

const getUserCount = async (req, res) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const count = await User.countDocuments({ _id: { $ne: decoded._id } });
        res.send({ count });
    } catch (error) {
        res.status(500).send(error);
    }
};

const validateUserId = async (req, res) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ _id: decoded._id }) || await Admin.findOne({ _id: decoded._id });

        if (!user) {
            return res.status(401).send({ error: 'Invalid user ID' });
        }

        res.send({ valid: true });
    } catch (error) {
        res.status(401).send({ error: 'Invalid user ID' });
    }
};

const getUserName = async (req, res) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded._id) || await Admin.findById(decoded._id);

        if (!user) {
            return res.status(404).send({ error: 'User not found' });
        }

        res.send({ username: user.username });
    } catch (error) {
        res.status(500).send(error);
    }
};

module.exports = {
    loginAdmin,
    loginUser,
    getAdmins,
    getUsers,
    createUser,
    deleteAdmin,
    deleteUser,
    getUserCount,
    validateUserId,
    getUserName,
    getAdminCount
};