
const crypto = require('crypto');
const config = require('../config/env');
const { withTransaction } = require('../config/db');
const OtpModel = require('../models/otpModel');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');

class OtpService {
  static hashOtp(otp) {
    return crypto
      .createHmac('sha256', config.jwtSecret)
      .update(otp)
      .digest('hex');
  }

  static createError(message, statusCode, extra = {}) {
    return Object.assign(new Error(message), {
      statusCode,
      ...extra,
    });
  }

  static async withUserLock(userId, callback) {
    return withTransaction(async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(
          hashtextextended($1, 0)
        )`,
        [`fortis-vault-otp:${userId}`]
      );

      return callback(client);
    });
  }

  static async generateAndSendOtp(
    user,
    { isResend = false, otpId = null } = {}
  ) {
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = this.hashOtp(otp);

    const result = await this.withUserLock(
      user.id,
      async (client) => {
        const latestOtp =
          await OtpModel.getLatestOtpForUser(user.id, client);

        if (
          isResend &&
          (!latestOtp ||
            latestOtp.id !== otpId ||
            latestOtp.verified)
        ) {
          throw this.createError(
            'Verification session is no longer active. Please log in again.',
            400
          );
        }

        if (latestOtp && !latestOtp.verified) {
          const createdAt = new Date(latestOtp.createdAt).getTime();
          const now = Date.now();

          const elapsedSeconds = Math.floor(
            (now - createdAt) / 1000
          );

          const expired =
            now >= new Date(latestOtp.expiresAt).getTime();

          if (
            !expired &&
            elapsedSeconds < config.otpResendCooldownSeconds
          ) {
            const remaining =
              config.otpResendCooldownSeconds - elapsedSeconds;

            if (isResend) {
              throw this.createError(
                `Please wait ${remaining} seconds before requesting a new OTP.`,
                429,
                { cooldownRemaining: remaining }
              );
            }

            return {
              existing: true,
              otpId: latestOtp.id,
              expiresInSeconds: Math.max(
                0,
                Math.floor(
                  (new Date(latestOtp.expiresAt).getTime() - now) /
                    1000
                )
              ),
              cooldownSeconds: remaining,
            };
          }
        }

        await OtpModel.invalidateUserOtps(user.id, client);

        const expiresAt = new Date(
          Date.now() + config.otpExpiryMinutes * 60 * 1000
        ).toISOString();

        const createdOtp = await OtpModel.create({
          userId: user.id,
          otpHash,
          expiresAt,
          client,
        });

        return {
          existing: false,
          otpId: createdOtp.id,
          expiresInSeconds: config.otpExpiryMinutes * 60,
          cooldownSeconds: config.otpResendCooldownSeconds,
        };
      }
    );

    if (result.existing) {
      return {
        success: true,
        otpId: result.otpId,
        message:
          'OTP has been sent to your registered email address. Please check your inbox.',
        expiresInSeconds: result.expiresInSeconds,
        cooldownSeconds: result.cooldownSeconds,
      };
    }

    try {
      await notificationService.sendOtp({
        recipient: user.email,
        otp,
        name: user.name,
      });
    } catch (error) {
      try {
        await this.withUserLock(user.id, async (client) => {
          const latestOtp =
            await OtpModel.getLatestOtpForUser(user.id, client);

          if (latestOtp && latestOtp.id === result.otpId) {
            await OtpModel.markVerified(result.otpId, client);
          }
        });
      } catch (invalidationError) {
        logger.error(
          `Failed to invalidate undelivered OTP: ${invalidationError.message}`
        );
      }

      throw error;
    }

    logger.security(`OTP generated for user: ${user.id}`);

    return {
      success: true,
      otpId: result.otpId,
      message:
        'OTP has been sent to your registered email address. Please check your inbox.',
      expiresInSeconds: result.expiresInSeconds,
      cooldownSeconds: result.cooldownSeconds,
    };
  }

  static async verifyOtp(userId, otpId, enteredOtp) {
    if (
      typeof enteredOtp !== 'string' ||
      !/^\d{6}$/.test(enteredOtp.trim())
    ) {
      throw this.createError(
        'Please enter a valid 6-digit OTP.',
        400
      );
    }

    const outcome = await this.withUserLock(
      userId,
      async (client) => {
        const latestOtp =
          await OtpModel.getLatestOtpForUser(userId, client);

        if (!latestOtp || latestOtp.id !== otpId) {
          return {
            error: this.createError(
              'This verification session is no longer active. Please log in again.',
              400
            ),
          };
        }

        if (latestOtp.verified) {
          return {
            error: this.createError(
              'This OTP has already been used. Please request a new one.',
              400
            ),
          };
        }

        if (
          Date.now() >= new Date(latestOtp.expiresAt).getTime()
        ) {
          return {
            error: this.createError(
              'OTP has expired. Please request a new OTP.',
              400
            ),
          };
        }

        if (latestOtp.attempts >= config.otpMaxAttempts) {
          return {
            error: this.createError(
              'Maximum verification attempts exceeded. Please request a new OTP.',
              429
            ),
          };
        }

        const updatedOtp = await OtpModel.incrementAttempts(
          otpId,
          client
        );

        if (!updatedOtp) {
          return {
            error: this.createError(
              'OTP is no longer active. Please request a new one.',
              400
            ),
          };
        }

        const inputHash = Buffer.from(
          this.hashOtp(enteredOtp.trim()),
          'hex'
        );

        const storedHash = Buffer.from(
          latestOtp.otpHash,
          'hex'
        );

        const isValid =
          storedHash.length === inputHash.length &&
          crypto.timingSafeEqual(inputHash, storedHash);

        if (!isValid) {
          const remaining =
            config.otpMaxAttempts - updatedOtp.attempts;

          logger.security(
            `Failed OTP attempt for user ${userId}. Remaining attempts: ${remaining}`
          );

          return {
            error: this.createError(
              remaining <= 0
                ? 'Invalid OTP. Maximum attempts reached. Please request a new OTP.'
                : `Invalid OTP. ${remaining} attempt(s) remaining.`,
              remaining <= 0 ? 429 : 400,
              { remainingAttempts: remaining }
            ),
          };
        }

        const verifiedOtp = await OtpModel.markVerified(
          otpId,
          client
        );

        if (!verifiedOtp) {
          return {
            error: this.createError(
              'OTP verification failed. Please request a new OTP.',
              400
            ),
          };
        }

        return {
          success: true,
        };
      }
    );

    // The transaction has committed before an API error is thrown.
    // Therefore, incorrect OTP attempts remain recorded.
    if (outcome.error) {
      throw outcome.error;
    }

    logger.security(
      `OTP successfully verified for user: ${userId}`
    );

    return {
      success: true,
      message: 'OTP verified successfully.',
    };
  }
}

module.exports = OtpService;
