const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const createAdminUser = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const adminUsername = 'marcoAdmin';
        const adminEmail = 'marco@memento.com';
        const adminPassword = '12345678';
        const adminName = 'Marco Alber';

        const existingAdmin = await Admin.findOne({ email: adminEmail });
        if (!existingAdmin) {
            const adminUser = new Admin({ username: adminUsername, email: adminEmail, password: adminPassword, name: adminName, role: 'admin' });
            await adminUser.save();
            console.log('Admin user created');
        } else {
            console.log('Admin user already exists');
        }

        mongoose.disconnect();
    } catch (error) {
        console.error('Error creating admin user:', error);
    }
};

createAdminUser();