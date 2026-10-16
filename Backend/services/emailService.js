import nodemailer from 'nodemailer';

let transporter = null;

/**
 * Initialize or get the email transporter instance
 */
async function getTransporter() {
  if (transporter) return transporter;

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_SECURE
  } = process.env;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    // Production / Configured SMTP Server
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });
    console.log(`[EmailService] Configured custom SMTP with host: ${SMTP_HOST}`);
  } else {
    // Create an Ethereal test account or local logging transporter
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      console.log(`[EmailService] Using Ethereal test SMTP account (${testAccount.user}) for credentials delivery.`);
    } catch (err) {
      console.warn(`[EmailService] Could not initialize Ethereal test account (${err.message}). Using console logger fallback.`);
      transporter = {
        sendMail: async (options) => {
          console.log('[EmailService:MOCK_SEND]', {
            to: options.to,
            subject: options.subject,
            preview: options.text || options.html
          });
          return { messageId: `mock_${Date.now()}` };
        }
      };
    }
  }

  return transporter;
}

/**
 * Send account credentials email to a newly created Company Admin
 */
export async function sendCompanyAdminCredentials({
  adminEmail,
  fullName,
  companyName,
  slug,
  password,
  loginUrl = 'http://localhost:5173/admin/login'
}) {
  try {
    const mailTransporter = await getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"SkillBridge Multi-Tenant" <no-reply@skillbridge.com>';

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your SkillBridge Company Admin Account</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #081a38; padding: 32px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">Skill<span style="color: #ff8c21;">Bridge</span></h1>
              <p style="margin: 6px 0 0; color: #94a3b8; font-size: 13px; font-weight: 500;">Corporate Multi-Tenant Safety & Skills Training Platform</p>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 30px;">
              <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 18px; font-weight: 700;">Welcome, ${fullName || 'Administrator'}!</h2>
              <p style="margin: 0 0 20px; color: #475569; font-size: 14px; line-height: 1.6;">
                Your dedicated company workspace and administrator account for <strong>${companyName}</strong> has been successfully provisioned on SkillBridge.
              </p>

              <!-- Credentials Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px; overflow: hidden;">
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
                    <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b;">Company Name</span>
                    <span style="display: block; font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px;">${companyName}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
                    <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b;">Company Code / Slug</span>
                    <span style="display: inline-block; font-family: monospace; font-size: 13px; font-weight: 700; color: #0369a1; background-color: #e0f2fe; padding: 3px 8px; border-radius: 6px; margin-top: 3px;">${slug}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
                    <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b;">Admin Login Email</span>
                    <span style="display: block; font-size: 14px; font-weight: 600; color: #0f172a; margin-top: 2px;">${adminEmail}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; background-color: #fef3c7; border-left: 4px solid #f59e0b;">
                    <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #92400e;">Initial Temporary Password</span>
                    <span style="display: block; font-family: monospace; font-size: 16px; font-weight: 800; color: #78350f; margin-top: 4px; letter-spacing: 0.5px;">${password}</span>
                  </td>
                </tr>
              </table>

              <!-- Steps Instructions -->
              <div style="background-color: #eff6ff; border-radius: 10px; padding: 16px 18px; margin-bottom: 24px; border: 1px solid #bfdbfe;">
                <h4 style="margin: 0 0 8px; color: #1e40af; font-size: 13px; font-weight: 700;">How to sign in:</h4>
                <ol style="margin: 0; padding-left: 18px; color: #1e3a8a; font-size: 13px; line-height: 1.5;">
                  <li>Visit the Company Admin Portal at the link below.</li>
                  <li>Enter your <strong>Company Code</strong>: <code style="background-color: #ffffff; padding: 1px 4px; border-radius: 4px;">${slug}</code></li>
                  <li>Enter your <strong>Admin Email</strong> and initial password.</li>
                </ol>
              </div>

              <!-- Action Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${loginUrl}" target="_blank" style="display: inline-block; background-color: #ff8c21; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 14px 32px; border-radius: 10px; box-shadow: 0 2px 8px rgba(255, 140, 33, 0.35);">
                      Sign In to Admin Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.5; border-top: 1px solid #e2e8f0; padding-top: 18px;">
                For security reasons, please change your temporary password after logging into your dashboard. If you did not request this account, please contact your system administrator.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                &copy; ${new Date().getFullYear()} SkillBridge. All rights reserved. Automated security notification.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `
Welcome to SkillBridge, ${fullName || 'Administrator'}!

Your dedicated company workspace and administrator account for ${companyName} has been provisioned.

Company Details & Credentials:
- Company Name: ${companyName}
- Company Code / Slug: ${slug}
- Admin Email: ${adminEmail}
- Initial Temporary Password: ${password}

Login Link: ${loginUrl}

How to sign in:
1. Open ${loginUrl}
2. Enter your Company Code: ${slug}
3. Enter your Email and Password.

For security, please change your password after logging in.
    `.trim();

    const info = await mailTransporter.sendMail({
      from: fromAddress,
      to: adminEmail,
      subject: `Your SkillBridge Admin Credentials for ${companyName}`,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null;
    console.log(`[EmailService] Admin credentials email sent to ${adminEmail} (MessageId: ${info.messageId})`);
    if (previewUrl) {
      console.log(`[EmailService] Test message preview URL: ${previewUrl}`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl
    };
  } catch (error) {
    console.error(`[EmailService] Failed to send credentials email to ${adminEmail}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send password reset code email to Company Admin
 */
export async function sendCompanyAdminPasswordReset({
  adminEmail,
  fullName,
  companyName,
  resetCode,
  expiresMinutes = 15
}) {
  try {
    const mailTransporter = await getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"SkillBridge Security" <no-reply@skillbridge.com>';

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your SkillBridge Admin Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #081a38; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">Skill<span style="color: #ff8c21;">Bridge</span></h1>
              <p style="margin: 6px 0 0; color: #94a3b8; font-size: 13px; font-weight: 500;">Admin Security & Access Management</p>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 30px;">
              <h2 style="margin: 0 0 10px; color: #0f172a; font-size: 19px; font-weight: 700;">Password Reset Request</h2>
              <p style="margin: 0 0 18px; color: #475569; font-size: 14px; line-height: 1.6;">
                Hello <strong>${fullName || 'Administrator'}</strong>,
              </p>
              <p style="margin: 0 0 20px; color: #475569; font-size: 14px; line-height: 1.6;">
                We received a request to reset the administrator password for your account associated with <strong>${companyName || 'your company'}</strong>.
              </p>

              <!-- OTP Box -->
              <div style="background-color: #f8fafc; border: 2px dashed #93c5fd; border-radius: 12px; padding: 22px; text-align: center; margin-bottom: 24px;">
                <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #0284c7; letter-spacing: 1px;">6-Digit Verification Code</span>
                <span style="display: block; font-family: monospace; font-size: 34px; font-weight: 800; color: #0f172a; letter-spacing: 8px; margin: 10px 0 6px;">${resetCode}</span>
                <span style="display: block; font-size: 12px; color: #64748b; font-weight: 500;">Valid for the next ${expiresMinutes} minutes</span>
              </div>

              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px 16px; margin-bottom: 24px;">
                <p style="margin: 0; color: #991b1b; font-size: 12.5px; line-height: 1.5;">
                  <strong>Security Note:</strong> Never share this verification code with anyone. SkillBridge support will never ask for your verification code.
                </p>
              </div>

              <p style="margin: 0; color: #64748b; font-size: 12.5px; line-height: 1.5; border-top: 1px solid #e2e8f0; padding-top: 18px;">
                If you did not request a password reset, you can safely disregard this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 18px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                &copy; ${new Date().getFullYear()} SkillBridge. Automated Security Notification.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `
Password Reset Request - SkillBridge Admin

Hello ${fullName || 'Administrator'},

We received a request to reset your password for ${companyName || 'your company'}.

Your 6-Digit Verification Code:
${resetCode}

This code will expire in ${expiresMinutes} minutes.

If you did not request this reset, please ignore this email.
    `.trim();

    const info = await mailTransporter.sendMail({
      from: fromAddress,
      to: adminEmail,
      subject: `SkillBridge Password Reset Code: ${resetCode}`,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null;
    console.log(`[EmailService] Password reset email sent to ${adminEmail} (Code: ${resetCode}, MessageId: ${info.messageId})`);
    if (previewUrl) {
      console.log(`[EmailService] Test message preview URL: ${previewUrl}`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl
    };
  } catch (error) {
    console.error(`[EmailService] Failed to send password reset email to ${adminEmail}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  sendCompanyAdminCredentials,
  sendCompanyAdminPasswordReset
};

