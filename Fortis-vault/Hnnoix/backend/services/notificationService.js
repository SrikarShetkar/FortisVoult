
const config = require('../config/env');

class NotificationService {
  constructor() {
    this.lastDispatchedOtp = null;
  }

  async sendOtp({ recipient, otp, name }) {
    // Preserve existing test-mode behavior.
    if (config.nodeEnv === 'test') {
      this.lastDispatchedOtp = {
        recipient,
        otp,
        dispatchedAt: new Date(),
      };

      return {
        success: true,
        message: 'Test OTP generated successfully.',
        recipient,
      };
    }

    if (!config.brevoApiKey) {
      throw new Error('BREVO_API_KEY is not configured.');
    }

    if (!config.emailFrom) {
      throw new Error('EMAIL_FROM is not configured.');
    }

    const payload = {
      sender: {
        name: 'Fortis Vault',
        email: config.emailFrom,
      },
      to: [{ email: recipient }],
      subject: 'Your Fortis Vault login code',
      textContent: [
        `Hello ${name},`,
        '',
        `Your Fortis Vault verification code is: ${otp}`,
        '',
        `This code expires in ${config.otpExpiryMinutes} minutes.`,
        '',
        'If you did not request this code, please ignore this email.',
        '',
        'Fortis Vault Security Team',
      ].join('\n'),
    };

    let response;

    try {
      response = await fetch(
        'https://api.brevo.com/v3/smtp/email',
        {
          method: 'POST',
          headers: {
            'api-key': config.brevoApiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );
    } catch (error) {
      console.error('Brevo network error:', error.message);
      throw new Error('Unable to connect to the email service.');
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Brevo API error:', {
        status: response.status,
        message: result.message || 'Email delivery failed',
      });

      throw new Error('Unable to send OTP email.');
    }

    return {
      success: true,
      messageId: result.messageId,
      provider: 'Brevo',
      recipient,
    };
  }

  getLastDispatchedOtp() {
    return config.nodeEnv === 'test'
      ? this.lastDispatchedOtp
      : null;
  }
}

module.exports = new NotificationService();
