
const logger = require('../utils/logger');
const config = require('../config/env');

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  logger.error(
    `Unhandled error on ${req.method} ${req.originalUrl}: ${err.message}`,
    err
  );

  let statusCode = err.statusCode ||
    (res.statusCode >= 400 ? res.statusCode : 500);

  let message = err.message ||
    'An unexpected server error occurred.';

  // PostgreSQL unique constraint violation.
  if (err.code === '23505') {
    statusCode = 409;

    if (err.constraint === 'users_email_key') {
      message = 'An account with this email already exists.';
    } else if (err.constraint === 'users_mobile_key') {
      message = 'An account with this mobile number already exists.';
    } else {
      message = 'A record with these details already exists.';
    }
  }

  // PostgreSQL foreign key violation.
  else if (err.code === '23503') {
    statusCode = 400;
    message = 'The referenced record does not exist.';
  }

  // PostgreSQL check constraint violation.
  else if (err.code === '23514') {
    statusCode = 400;
    message = 'The submitted data violates a database constraint.';
  }

  // Do not expose internal database or server errors in production.
  if (statusCode >= 500 && config.nodeEnv === 'production') {
    message = 'An unexpected server error occurred.';
  }

  return res.status(statusCode).json({
    success: false,
    message,
    ...(config.nodeEnv === 'development' && {
      stack: err.stack,
    }),
  });
}

module.exports = errorHandler;
