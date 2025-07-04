# Marketing Manager - Enhanced Email System

## Overview

The Marketing Manager now features **user-specific email configurations**, allowing each user to set up their own email credentials that are securely saved to the database for future use.

## ✨ New Features

### User-Specific Email Configuration
- Each user can configure their own sender email and credentials
- Email settings are saved securely in the database
- Automatic verification of email configurations
- Support for multiple email providers (Gmail, Outlook, Yahoo, Custom SMTP)

### Enhanced Security
- No hardcoded email credentials in environment files
- User-isolated email configurations
- Encrypted password storage
- Configuration verification status tracking

## 🚀 Setup Instructions

### 1. Database Models
The system now includes two main models:

**EmailConfig Model:**
- Stores user-specific email configurations
- Supports multiple email providers
- Tracks verification status
- Secure password storage

**EmailTemplate Model:**
- User-specific email templates
- Support for HTML and plain text
- Template versioning and metadata

### 2. User Setup Process

1. **Access Marketing Manager** from the dashboard
2. **Click "Setup Email"** if no configuration exists
3. **Fill in Email Configuration:**
   - **Sender Email**: Your business email address
   - **App Password**: Generated app password (not regular password)
   - **Sender Name**: Display name for outgoing emails
   - **Email Service**: Choose from Gmail, Outlook, Yahoo, or Custom SMTP

4. **Save & Test**: The system automatically verifies the configuration

### 3. Gmail Setup (Recommended)

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate App Password:**
   - Go to Google Account → Security → 2-Step Verification
   - App passwords → Generate password for "Mail"
   - Use this 16-character password in the configuration

3. **Configure in Dashboard:**
   ```
   Sender Email: your-business@gmail.com
   App Password: [16-character app password]
   Sender Name: Your Business Name
   Email Service: Gmail
   ```

### 4. Other Email Providers

**Outlook/Hotmail:**
- Use App Password from Microsoft Account Security settings
- Service: Outlook

**Yahoo:**
- Generate App Password from Yahoo Account Security
- Service: Yahoo

**Custom SMTP:**
- Provide custom host and port
- Service: Custom SMTP

## 📧 API Endpoints

### Email Configuration
- `GET /api/marketing/email-config` - Get user's email configuration
- `POST /api/marketing/email-config` - Create/update email configuration
- `DELETE /api/marketing/email-config` - Delete email configuration
- `GET /api/marketing/test-config` - Test email configuration

### Email Operations
- `POST /api/marketing/send-email` - Send emails (requires valid config)
- `GET /api/marketing/templates` - Get user templates
- `POST /api/marketing/templates` - Create template
- `PUT /api/marketing/templates/:id` - Update template
- `DELETE /api/marketing/templates/:id` - Delete template

## 🔧 Features

### 1. Email Composition
- **Simple Mode**: Plain text with variable support
- **HTML Mode**: Rich HTML with Tailwind CSS and Monaco Editor
- **Variable System**: $email, $userName, $companyName, $date

### 2. Template Management
- Save frequently used email templates
- Load templates into composer
- Edit and delete existing templates
- HTML and text template support

### 3. Preview System
- Live preview with variable replacement
- Sample data visualization
- HTML rendering preview

### 4. Configuration Management
- One-time setup per user
- Automatic credential verification
- Status indicators (Verified/Not Verified)
- Easy configuration updates

## 🛡️ Security Features

### Data Protection
- User-isolated configurations
- Secure password storage
- No shared credentials
- Environment-independent setup

### Verification System
- Automatic SMTP verification
- Real-time status updates
- Error handling and reporting
- Configuration validation

## 📝 Usage Examples

### Simple Email Template
```
Subject: Welcome to $companyName, $userName!

Hello $userName,

Thank you for joining our community at $companyName.
Your email $email has been successfully registered on $date.

Best regards,
The $companyName Team
```

### HTML Email Template
```html
<div class="bg-gradient-to-r from-blue-500 to-purple-600 p-8 rounded-lg text-white">
  <h1 class="text-3xl font-bold mb-4">Welcome $userName!</h1>
  <div class="bg-white text-gray-800 p-6 rounded-lg">
    <p class="mb-4">Thank you for joining <strong>$companyName</strong>!</p>
    <div class="border-l-4 border-blue-500 pl-4 mb-4">
      <p class="text-sm">Account: $email</p>
      <p class="text-sm">Registration Date: $date</p>
    </div>
    <a href="#" class="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600">
      Get Started
    </a>
  </div>
</div>
```

## 🔍 Troubleshooting

### Common Issues

1. **"Email configuration not found"**
   - Set up email configuration in Marketing Manager
   - Ensure configuration is saved and verified

2. **"Authentication failed"**
   - Check email and app password
   - Verify 2FA is enabled for Gmail
   - Use app password, not regular password

3. **"SMTP connection failed"**
   - Check email service settings
   - Verify custom SMTP details (if using custom)
   - Test configuration using "Test Config" button

4. **"Template not loading"**
   - Ensure template belongs to current user
   - Check template format (HTML/Text)

### Verification Status

- ✅ **Verified**: Configuration tested and working
- ⚠️ **Not Verified**: Configuration saved but not tested
- ❌ **Failed**: Configuration has errors

## 🚀 Getting Started

1. Navigate to **Marketing Manager** in the dashboard
2. Click **"Setup Email"** to configure your email settings
3. Follow the setup wizard for your email provider
4. **Save & Test** your configuration
5. Start creating and sending professional emails!

## 📞 Support

For technical support or questions about email configuration:
- Check the setup instructions for your email provider
- Use the "Test Config" feature to diagnose issues
- Ensure you're using app passwords, not regular passwords
