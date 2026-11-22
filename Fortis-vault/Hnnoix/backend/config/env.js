
const path = require('path');
const dotenv = require('dotenv');

// The test helper sets NODE_ENV before the application is imported.
const nodeEnv = process.env.NODE_ENV || 'development';

const envFile =
  nodeEnv === 'test'
    ? '../.env.test'
    : '../.env';

dotenv.config({
  path: path.resolve(__dirname, envFile),
  override: nodeEnv === 'test',
});

if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production.');
}

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv,

  jwtSecret:
    process.env.JWT_SECRET ||
    'development_only_change_this_secret',

  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',

  otpExpiryMinutes:
    parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 5,

  otpMaxAttempts:
    parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 3,

  otpResendCooldownSeconds:
    parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS, 10) || 60,

  databaseUrl: process.env.DATABASE_URL || '',

  brevoApiKey: process.env.BREVO_API_KEY || '',

  emailFrom:
    process.env.EMAIL_FROM || 'mybankingapp.otp@gmail.com',

  corsOrigin:
    process.env.CORS_ORIGIN || 'http://localhost:5173',
};

if (nodeEnv === 'test' && !config.databaseUrl) {
  throw new Error(
    'DATABASE_URL is missing from the test environment.'
  );
}

module.exports = config;
