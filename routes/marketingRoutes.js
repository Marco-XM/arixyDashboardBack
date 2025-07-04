const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const EmailTemplate = require('../models/EmailTemplate');
const EmailConfig = require('../models/EmailConfig');
const auth = require('../middleware/auth');

// Configure nodemailer transporter with user's email config
const createTransporter = async (userId, configId = null) => {
  let emailConfig;
  
  if (configId) {
    emailConfig = await EmailConfig.findOne({ _id: configId, userId });
  } else {
    // Get default config or first available config
    emailConfig = await EmailConfig.findOne({ userId, isDefault: true }) || 
                  await EmailConfig.findOne({ userId });
  }
  
  if (!emailConfig) {
    throw new Error('Email configuration not found. Please set up your email settings first.');
  }

  const transporterConfig = {
    auth: {
      user: emailConfig.senderEmail,
      pass: emailConfig.senderPassword
    }
  };

  // Configure based on email service
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
};

// Send email
router.post('/send-email', auth, async (req, res) => {
  try {
    const { emails, subject, message, isHtml, configId } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Emails array is required' });
    }

    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message are required' });
    }

    const transporter = await createTransporter(req.user.id, configId);
    const emailConfig = configId 
      ? await EmailConfig.findOne({ _id: configId, userId: req.user.id })
      : await EmailConfig.findOne({ userId: req.user.id, isDefault: true }) || 
        await EmailConfig.findOne({ userId: req.user.id });

    // Validate transporter configuration
    await transporter.verify();

    // Process variables in the message
    const processMessage = (content, email) => {
      return content
        .replace(/\$email/g, email)
        .replace(/\$userName/g, email.split('@')[0]) // Extract username from email
        .replace(/\$companyName/g, emailConfig.senderName || 'Your Company')
        .replace(/\$date/g, new Date().toLocaleDateString());
    };

    // Send emails
    const emailPromises = emails.map(async (email) => {
      const processedMessage = processMessage(message, email);
      
      const mailOptions = {
        from: {
          name: emailConfig.senderName,
          address: emailConfig.senderEmail
        },
        to: email,
        subject: processMessage(subject, email),
        [isHtml ? 'html' : 'text']: processedMessage
      };

      return transporter.sendMail(mailOptions);
    });

    await Promise.all(emailPromises);

    res.json({ 
      message: `Emails sent successfully to ${emails.length} recipients`,
      count: emails.length 
    });

  } catch (error) {
    console.error('Error sending emails:', error);
    res.status(500).json({ 
      error: 'Failed to send emails', 
      details: error.message 
    });
  }
});

// Get all templates
router.get('/templates', auth, async (req, res) => {
  try {
    const templates = await EmailTemplate.find({ createdBy: req.user.id })
      .sort({ createdAt: -1 })
      .select('name subject content isHtml createdAt updatedAt');
    
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Get template by ID
router.get('/templates/:id', auth, async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// Create new template
router.post('/templates', auth, async (req, res) => {
  try {
    const { name, subject, content, isHtml } = req.body;

    if (!name || !subject || !content) {
      return res.status(400).json({ error: 'Name, subject, and content are required' });
    }

    // Check if template name already exists for this user
    const existingTemplate = await EmailTemplate.findOne({
      name,
      createdBy: req.user.id
    });

    if (existingTemplate) {
      return res.status(400).json({ error: 'Template name already exists' });
    }

    const template = new EmailTemplate({
      name,
      subject,
      content,
      isHtml: isHtml || false,
      createdBy: req.user.id
    });

    await template.save();

    res.status(201).json({
      message: 'Template created successfully',
      template: {
        _id: template._id,
        name: template.name,
        subject: template.subject,
        isHtml: template.isHtml,
        createdAt: template.createdAt
      }
    });

  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update template
router.put('/templates/:id', auth, async (req, res) => {
  try {
    const { name, subject, content, isHtml } = req.body;

    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Check if new name conflicts with existing template
    if (name && name !== template.name) {
      const existingTemplate = await EmailTemplate.findOne({
        name,
        createdBy: req.user.id,
        _id: { $ne: req.params.id }
      });

      if (existingTemplate) {
        return res.status(400).json({ error: 'Template name already exists' });
      }
    }

    // Update fields
    if (name) template.name = name;
    if (subject) template.subject = subject;
    if (content) template.content = content;
    if (typeof isHtml !== 'undefined') template.isHtml = isHtml;

    await template.save();

    res.json({
      message: 'Template updated successfully',
      template: {
        _id: template._id,
        name: template.name,
        subject: template.subject,
        isHtml: template.isHtml,
        updatedAt: template.updatedAt
      }
    });

  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete template
router.delete('/templates/:id', auth, async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await EmailTemplate.findByIdAndDelete(req.params.id);

    res.json({ message: 'Template deleted successfully' });

  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Test email configuration
router.get('/test-config/:id?', auth, async (req, res) => {
  try {
    const configId = req.params.id;
    
    // Find the specific config or default config
    let emailConfig;
    if (configId) {
      emailConfig = await EmailConfig.findOne({ _id: configId, userId: req.user.id });
    } else {
      emailConfig = await EmailConfig.findOne({ userId: req.user.id, isDefault: true }) || 
                    await EmailConfig.findOne({ userId: req.user.id });
    }
    
    if (!emailConfig) {
      return res.status(400).json({ 
        error: 'No email configuration found', 
        details: 'Please set up your email configuration first before testing.' 
      });
    }

    const transporter = await createTransporter(req.user.id, emailConfig._id);
    await transporter.verify();
    
    // Update verification status
    await EmailConfig.findOneAndUpdate(
      { _id: emailConfig._id },
      { isVerified: true, lastVerified: new Date() }
    );
    
    res.json({ message: 'Email configuration is valid' });
  } catch (error) {
    console.error('Email configuration error:', error);
    
    // Only try to update verification status if config exists
    try {
      const emailConfig = await EmailConfig.findOne({ userId: req.user.id });
      if (emailConfig) {
        await EmailConfig.findOneAndUpdate(
          { userId: req.user.id },
          { isVerified: false }
        );
      }
    } catch (updateError) {
      console.error('Error updating verification status:', updateError);
    }
    
    res.status(500).json({ 
      error: 'Email configuration is invalid', 
      details: error.message 
    });
  }
});

// Get user's email configurations
router.get('/email-config', auth, async (req, res) => {
  try {
    const emailConfigs = await EmailConfig.find({ userId: req.user.id }).select('-senderPassword');
    
    if (!emailConfigs || emailConfigs.length === 0) {
      return res.status(404).json({ error: 'No email configurations found' });
    }
    
    res.json(emailConfigs);
  } catch (error) {
    console.error('Error fetching email configs:', error);
    res.status(500).json({ error: 'Failed to fetch email configurations' });
  }
});

// Get single email configuration
router.get('/email-config/:id', auth, async (req, res) => {
  try {
    const emailConfig = await EmailConfig.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    }).select('-senderPassword');
    
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email configuration not found' });
    }
    
    res.json(emailConfig);
  } catch (error) {
    console.error('Error fetching email config:', error);
    res.status(500).json({ error: 'Failed to fetch email configuration' });
  }
});

// Delete email configuration
router.delete('/email-config/:id', auth, async (req, res) => {
  try {
    const emailConfig = await EmailConfig.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user.id 
    });
    
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email configuration not found' });
    }

    // If deleted config was default, set another one as default
    if (emailConfig.isDefault) {
      const firstConfig = await EmailConfig.findOne({ userId: req.user.id });
      if (firstConfig) {
        firstConfig.isDefault = true;
        await firstConfig.save();
      }
    }
    
    res.json({ message: 'Email configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting email config:', error);
    res.status(500).json({ error: 'Failed to delete email configuration' });
  }
});

// Set default email configuration
router.put('/email-config/:id/default', auth, async (req, res) => {
  try {
    // Unset all defaults
    await EmailConfig.updateMany(
      { userId: req.user.id },
      { isDefault: false }
    );

    // Set the specified config as default
    const emailConfig = await EmailConfig.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { isDefault: true },
      { new: true }
    ).select('-senderPassword');
    
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email configuration not found' });
    }
    
    res.json({ message: 'Default email configuration updated', config: emailConfig });
  } catch (error) {
    console.error('Error setting default email config:', error);
    res.status(500).json({ error: 'Failed to set default email configuration' });
  }
});

// Create or update email configuration
router.post('/email-config', auth, async (req, res) => {
  try {
    const { senderEmail, senderPassword, senderName, emailService, customHost, customPort, isDefault, configId } = req.body;

    let emailConfig;
    if (configId) {
      // Update existing config - only update provided fields
      const existingConfig = await EmailConfig.findOne({ _id: configId, userId: req.user.id });
      
      if (!existingConfig) {
        return res.status(404).json({ error: 'Email configuration not found or you do not have permission to update it' });
      }

      // Build update data with only provided fields
      const updateData = {};
      if (senderName !== undefined) updateData.senderName = senderName;
      if (senderEmail !== undefined) updateData.senderEmail = senderEmail;
      if (senderPassword !== undefined) updateData.senderPassword = senderPassword;
      if (emailService !== undefined) updateData.emailService = emailService;
      if (customHost !== undefined) updateData.customHost = customHost;
      if (customPort !== undefined) updateData.customPort = customPort;
      if (isDefault !== undefined) updateData.isDefault = isDefault;

      // If setting as default, unset other defaults
      if (isDefault) {
        await EmailConfig.updateMany(
          { userId: req.user.id, _id: { $ne: configId } },
          { isDefault: false }
        );
      }

      // Only reset verification if critical fields changed
      if (senderEmail !== undefined || senderPassword !== undefined || emailService !== undefined || customHost !== undefined || customPort !== undefined) {
        updateData.isVerified = false;
      }

      emailConfig = await EmailConfig.findOneAndUpdate(
        { _id: configId, userId: req.user.id },
        updateData,
        { new: true }
      );
    } else {
      // Creating new config - require all fields
      if (!senderEmail || !senderPassword || !senderName) {
        return res.status(400).json({ error: 'Sender email, password, and name are required' });
      }

      if (emailService === 'custom' && (!customHost || !customPort)) {
        return res.status(400).json({ error: 'Custom host and port are required for custom email service' });
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await EmailConfig.updateMany(
          { userId: req.user.id },
          { isDefault: false }
        );
      }

      const configData = {
        userId: req.user.id,
        senderEmail,
        senderPassword,
        senderName,
        emailService: emailService || 'gmail',
        customHost: emailService === 'custom' ? customHost : undefined,
        customPort: emailService === 'custom' ? customPort : undefined,
        isVerified: false,
        isDefault: isDefault || false
      };
      // Check if email already exists for this user
      const existingConfig = await EmailConfig.findOne({ 
        userId: req.user.id, 
        senderEmail 
      });
      
      if (existingConfig) {
        return res.status(400).json({ error: 'An email configuration with this sender email already exists' });
      }

      // If this is the first config, make it default
      const configCount = await EmailConfig.countDocuments({ userId: req.user.id });
      configData.isDefault = configCount === 0 || isDefault;

      emailConfig = new EmailConfig(configData);
      await emailConfig.save();
    }

    // Test the configuration only if critical fields were changed or it's a new config
    const shouldTestConfig = !configId || 
      (senderEmail !== undefined || senderPassword !== undefined || 
       emailService !== undefined || customHost !== undefined || customPort !== undefined);

    if (shouldTestConfig) {
      try {
        const transporter = await createTransporter(req.user.id, emailConfig._id);
        await transporter.verify();
        
        emailConfig.isVerified = true;
        emailConfig.lastVerified = new Date();
        await emailConfig.save();
        
        res.json({ 
          message: configId ? 'Email configuration updated and verified successfully' : 'Email configuration saved and verified successfully',
          config: {
            _id: emailConfig._id,
            senderEmail: emailConfig.senderEmail,
            senderName: emailConfig.senderName,
            emailService: emailConfig.emailService,
            isVerified: emailConfig.isVerified,
            isDefault: emailConfig.isDefault,
            lastVerified: emailConfig.lastVerified
          }
        });
      } catch (verifyError) {
        res.json({ 
          message: configId ? 'Email configuration updated but verification failed' : 'Email configuration saved but verification failed',
          error: verifyError.message,
          config: {
            _id: emailConfig._id,
            senderEmail: emailConfig.senderEmail,
            senderName: emailConfig.senderName,
            emailService: emailConfig.emailService,
            isVerified: false,
            isDefault: emailConfig.isDefault
          }
        });
      }
    } else {
      // Just return success for non-critical updates (like sender name only)
      res.json({ 
        message: 'Email configuration updated successfully',
        config: {
          _id: emailConfig._id,
          senderEmail: emailConfig.senderEmail,
          senderName: emailConfig.senderName,
          emailService: emailConfig.emailService,
          isVerified: emailConfig.isVerified,
          isDefault: emailConfig.isDefault,
          lastVerified: emailConfig.lastVerified
        }
      });
    }

  } catch (error) {
    console.error('Error saving email config:', error);
    res.status(500).json({ error: 'Failed to save email configuration' });
  }
});

// Delete email configuration
router.delete('/email-config', auth, async (req, res) => {
  try {
    const emailConfig = await EmailConfig.findOneAndDelete({ userId: req.user.id });
    
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email configuration not found' });
    }
    
    res.json({ message: 'Email configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting email config:', error);
    res.status(500).json({ error: 'Failed to delete email configuration' });
  }
});

module.exports = router;
