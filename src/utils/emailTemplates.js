/**
 * Email templates for admin email system
 * Provides consistent and professional email templates
 */

/**
 * Generate a professional HTML email template for message blasts
 * Matches YouCalendy brand design with #556B2F green and #323334 dark colors
 * @param {string} businessName - Business name
 * @param {string} subject - Email subject
 * @param {string} message - Email message content (can be HTML)
 * @param {string} logoUrl - Optional business logo URL
 * @returns {string} Complete HTML email
 */
// Helper function to escape HTML
const escapeHtml = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const generateMessageBlastTemplate = (businessName, subject, message, logoUrl = null) => {
  // Escape business name and subject for security
  const safeBusinessName = escapeHtml(businessName);
  const safeSubject = escapeHtml(subject);
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : null;
  
  // Convert line breaks to HTML and escape any potentially dangerous content
  // First, check if message already contains HTML tags
  const hasHTML = /<[a-z][\s\S]*>/i.test(message);
  
  let formattedMessage;
  if (hasHTML) {
    // If HTML is detected, use it as-is (user may have formatted it)
    // Note: In production, you might want to sanitize this with a library like DOMPurify
    formattedMessage = message;
  } else {
    // Convert line breaks to HTML for plain text
    formattedMessage = escapeHtml(message).replace(/\n/g, '<br>');
  }
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #323334;
                background-color: #f5f5f5;
                padding: 0;
                margin: 0;
            }
            .email-wrapper {
                max-width: 600px;
                margin: 0 auto;
                background-color: #ffffff;
            }
            .email-header {
                background: linear-gradient(135deg, #556B2F 0%, #6A8838 100%);
                padding: 30px 40px;
                text-align: center;
            }
            .logo-container {
                margin-bottom: 15px;
            }
            .logo-container img {
                max-width: 180px;
                height: auto;
            }
            .business-name {
                color: #ffffff;
                font-size: 24px;
                font-weight: 600;
                letter-spacing: 0.5px;
                margin: 0;
            }
            .email-body {
                padding: 40px;
            }
            .email-subject {
                color: #323334;
                font-size: 20px;
                font-weight: 600;
                margin-bottom: 25px;
                line-height: 1.4;
            }
            .email-content {
                color: #323334;
                font-size: 16px;
                font-weight: 400;
                line-height: 1.8;
                margin-bottom: 30px;
            }
            .email-content p {
                margin-bottom: 15px;
            }
            .email-content p:last-child {
                margin-bottom: 0;
            }
            .email-footer {
                background-color: #fafafa;
                padding: 30px 40px;
                text-align: center;
                border-top: 1px solid #e5e5e5;
            }
            .footer-text {
                color: #666666;
                font-size: 14px;
                line-height: 1.6;
                margin-bottom: 10px;
            }
            .footer-text:last-child {
                margin-bottom: 0;
            }
            .footer-brand {
                color: #556B2F;
                font-weight: 600;
                margin-top: 15px;
                font-size: 14px;
            }
            .divider {
                height: 1px;
                background: linear-gradient(to right, transparent, #e5e5e5, transparent);
                margin: 30px 0;
            }
            @media only screen and (max-width: 600px) {
                .email-header {
                    padding: 25px 20px;
                }
                .business-name {
                    font-size: 20px;
                }
                .email-body {
                    padding: 30px 20px;
                }
                .email-subject {
                    font-size: 18px;
                }
                .email-content {
                    font-size: 15px;
                }
                .email-footer {
                    padding: 25px 20px;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-wrapper">
            <div class="email-header">
                ${safeLogoUrl ? `<div class="logo-container"><img src="${safeLogoUrl}" alt="${safeBusinessName}" /></div>` : ''}
                <h1 class="business-name">${safeBusinessName}</h1>
            </div>
            <div class="email-body">
                <h2 class="email-subject">${safeSubject}</h2>
                <div class="divider"></div>
                <div class="email-content">
                    ${formattedMessage}
                </div>
            </div>
            <div class="email-footer">
                <p class="footer-text">This message was sent to you by ${safeBusinessName}</p>
                <p class="footer-text">If you have any questions, please contact the business directly.</p>
                <p class="footer-brand">YouCalendy</p>
            </div>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate a professional HTML email template
 * @param {string} title - Email title
 * @param {string} content - Email content (can be HTML)
 * @param {string} footerText - Optional footer text
 * @returns {string} Complete HTML email
 */
const generateEmailTemplate = (title, content, footerText = null) => {
  const footer = footerText || "Thank you for using our platform.";

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            body {
                font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #323334;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            .email-container {
                background-color: #ffffff;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                border-bottom: 2px solid #556B2F;
                padding-bottom: 20px;
                margin-bottom: 30px;
            }
            .header h1 {
                color: #556B2F;
                margin: 0;
                font-size: 24px;
                font-weight: 600;
            }
            .content {
                margin-bottom: 30px;
            }
            .content p {
                margin-bottom: 15px;
            }
            .footer {
                text-align: center;
                border-top: 1px solid #eee;
                padding-top: 20px;
                color: #666;
                font-size: 14px;
            }
            .footer p {
                margin: 5px 0;
            }
            .highlight {
                background-color: #f8f9fa;
                padding: 15px;
                border-left: 4px solid #556B2F;
                margin: 20px 0;
            }
            .button {
                display: inline-block;
                background-color: #556B2F;
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 8px;
                margin: 10px 0;
                font-weight: 500;
            }
            .button:hover {
                background-color: #6A8838;
            }
            @media only screen and (max-width: 600px) {
                body {
                    padding: 10px;
                }
                .email-container {
                    padding: 20px;
                }
                .header h1 {
                    font-size: 20px;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <h1>${title}</h1>
            </div>
            <div class="content">
                ${content}
            </div>
            <div class="footer">
                <p>${footer}</p>
                <p>This is an automated message from our platform.</p>
                <p>If you have any questions, please contact our support team.</p>
            </div>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate a simple text email template
 * @param {string} title - Email title
 * @param {string} content - Email content
 * @param {string} footerText - Optional footer text
 * @returns {string} Plain text email
 */
const generateTextTemplate = (title, content, footerText = null) => {
  const footer = footerText || "Thank you for using our platform.";

  return `
${title}

${content}

---
${footer}
This is an automated message from our platform.
If you have any questions, please contact our support team.
  `.trim();
};

/**
 * Generate announcement email template
 * @param {string} announcement - Announcement content
 * @param {string} type - Type of announcement (info, warning, success, etc.)
 * @returns {object} Object with html and text versions
 */
const generateAnnouncementTemplate = (announcement, type = "info") => {
  const typeStyles = {
    info: { color: "#007bff", icon: "ℹ️" },
    warning: { color: "#ffc107", icon: "⚠️" },
    success: { color: "#28a745", icon: "✅" },
    error: { color: "#dc3545", icon: "❌" },
  };

  const style = typeStyles[type] || typeStyles.info;

  const htmlContent = `
    <div class="highlight" style="border-left-color: ${style.color};">
        <p><strong>${style.icon} Announcement</strong></p>
        <p>${announcement}</p>
    </div>
  `;

  const textContent = `
${style.icon} ANNOUNCEMENT

${announcement}
  `;

  return {
    html: generateEmailTemplate("Platform Announcement", htmlContent),
    text: generateTextTemplate("Platform Announcement", textContent),
  };
};

/**
 * Generate newsletter email template
 * @param {string} title - Newsletter title
 * @param {Array} articles - Array of article objects with title and content
 * @returns {object} Object with html and text versions
 */
const generateNewsletterTemplate = (title, articles) => {
  let htmlContent = `<h2>${title}</h2>`;
  let textContent = `${title}\n\n`;

  articles.forEach((article, index) => {
    htmlContent += `
      <div style="margin-bottom: 25px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
        <h3 style="color: #007bff; margin-bottom: 10px;">${article.title}</h3>
        <p>${article.content}</p>
      </div>
    `;

    textContent += `${article.title}\n${article.content}\n\n`;
  });

  return {
    html: generateEmailTemplate("Newsletter", htmlContent),
    text: generateTextTemplate("Newsletter", textContent),
  };
};

/**
 * Generate promotional email template
 * @param {string} title - Promotion title
 * @param {string} description - Promotion description
 * @param {string} ctaText - Call to action text
 * @param {string} ctaLink - Call to action link
 * @returns {object} Object with html and text versions
 */
const generatePromotionalTemplate = (title, description, ctaText, ctaLink) => {
  const htmlContent = `
    <h2 style="color: #007bff;">${title}</h2>
    <p>${description}</p>
    <div style="text-align: center; margin: 30px 0;">
        <a href="${ctaLink}" class="button" style="background-color: #28a745;">${ctaText}</a>
    </div>
  `;

  const textContent = `
${title}

${description}

${ctaText}: ${ctaLink}
  `;

  return {
    html: generateEmailTemplate("Special Offer", htmlContent),
    text: generateTextTemplate("Special Offer", textContent),
  };
};

module.exports = {
  generateEmailTemplate,
  generateTextTemplate,
  generateAnnouncementTemplate,
  generateNewsletterTemplate,
  generatePromotionalTemplate,
  generateMessageBlastTemplate,
};
