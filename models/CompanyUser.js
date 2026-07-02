const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// A staff account belonging to a client Company. These accounts log in from the
// public landing site portal (never the dashboard). Auth is handled by
// middleware/companyAuth.js which scopes every request to the user's company.
const companyUserSchema = new mongoose.Schema({
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    role: {
        type: String,
        enum: ['owner', 'manager', 'member'],
        default: 'member'
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    lastLogin: {
        type: Date,
        required: false
    }
}, {
    timestamps: true
});

companyUserSchema.index({ company: 1, status: 1 });

// Hash password on create/change, mirroring the Admin/User models.
companyUserSchema.pre('save', async function (next) {
    const user = this;
    if (user.isModified('password')) {
        user.password = await bcrypt.hash(user.password, 8);
    }
    next();
});

module.exports = mongoose.model('CompanyUser', companyUserSchema);
