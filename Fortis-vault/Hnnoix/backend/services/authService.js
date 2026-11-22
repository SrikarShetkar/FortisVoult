
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { query } = require('../config/db');
const logger = require('../utils/logger');

class AuthService {
  static async hashPassword(password) {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  static async comparePassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Generate an access token with a unique JWT ID.
   */
  static generateToken(payload) {
    return jwt.sign(
      {
        ...payload,
        jti: crypto.randomUUID(),
      },
      config.jwtSecret,
      {
        expiresIn: config.jwtExpiresIn,
      }
    );
  }

  /**
   * Generate a temporary OTP challenge token.
   */
  static generateOtpChallengeToken(userId, otpId, expiresInSeconds) {
    return jwt.sign(
      {
        userId,
        otpId,
        purpose: 'otp',
      },
      config.jwtSecret,
      {
        expiresIn: expiresInSeconds + config.otpResendCooldownSeconds,
      }
    );
  }

  /**
   * Verify the temporary OTP challenge token.
   */
  static verifyOtpChallengeToken(token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);

      if (
        payload.purpose !== 'otp' ||
        typeof payload.userId !== 'string' ||
        typeof payload.otpId !== 'string'
      ) {
        throw new Error('Invalid challenge claims');
      }

      return payload;
    } catch (error) {
      const challengeError = new Error(
        'Verification session is invalid or expired. Please log in again.'
      );

      challengeError.statusCode = 401;
      throw challengeError;
    }
  }

  /**
   * Verify an access token and check PostgreSQL for revocation.
   */
  static async verifyToken(token) {
    const payload = jwt.verify(token, config.jwtSecret);

    if (typeof payload.jti !== 'string' || !payload.exp) {
      throw new Error('Invalid access token claims');
    }

    const result = await query(
      `SELECT jti
       FROM revoked_tokens
       WHERE jti = $1
         AND expires_at > NOW()
       LIMIT 1`,
      [payload.jti]
    );

    if (result.rows.length > 0) {
      throw new Error('Token has been revoked upon logout');
    }

    return payload;
  }

  /**
   * Persist token revocation in PostgreSQL.
   */
  static async invalidateToken(token) {
    if (!token) return;

    const payload = jwt.verify(token, config.jwtSecret);

    if (typeof payload.jti !== 'string' || !payload.exp) {
      throw new Error('Cannot revoke token without a valid JWT ID and expiry');
    }

    await query(
      `INSERT INTO revoked_tokens (jti, expires_at)
       VALUES ($1, TO_TIMESTAMP($2))
       ON CONFLICT (jti) DO NOTHING`,
      [payload.jti, payload.exp]
    );

    logger.security('Token revoked and stored in PostgreSQL');
  }
}

module.exports = AuthService;
