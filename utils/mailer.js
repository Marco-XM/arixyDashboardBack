const nodemailer = require('nodemailer');
const EmailConfig = require('../models/EmailConfig');

// Shared SMTP helpers for everything that sends mail as a dashboard user
// (marketing campaigns, client reports). Credentials live per user in
// EmailConfig, managed from Marketing → Email settings.

// The requested config, else the user's default, else their first one.
async function findEmailConfig(userId, configId = null) {
    if (configId) return EmailConfig.findOne({ _id: configId, userId });
    return (await EmailConfig.findOne({ userId, isDefault: true }))
        || EmailConfig.findOne({ userId });
}

function transporterFromConfig(emailConfig) {
    const transporterConfig = {
        auth: {
            user: emailConfig.senderEmail,
            pass: emailConfig.senderPassword,
        },
    };

    switch (emailConfig.emailService) {
        case 'gmail':
            transporterConfig.service = 'gmail';
            break;
        case 'outlook':
            transporterConfig.service = 'hotmail';
            break;
        case 'yahoo':
            transporterConfig.service = 'yahoo';
            break;
        case 'custom':
            transporterConfig.host = emailConfig.customHost;
            transporterConfig.port = emailConfig.customPort;
            transporterConfig.secure = emailConfig.customPort === 465;
            break;
        default:
            transporterConfig.service = 'gmail';
    }

    return nodemailer.createTransport(transporterConfig);
}

// Configure nodemailer transporter with user's email config
async function createTransporter(userId, configId = null) {
    const emailConfig = await findEmailConfig(userId, configId);
    if (!emailConfig) {
        throw new Error('Email configuration not found. Please set up your email settings first.');
    }
    return transporterFromConfig(emailConfig);
}

module.exports = { findEmailConfig, transporterFromConfig, createTransporter };
