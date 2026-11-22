
const UserModel = require('../models/userModel');
const AccountModel = require('../models/accountModel');
const TransactionModel = require('../models/transactionModel');
const AuthService = require('../services/authService');
const OtpService = require('../services/otpService');
const { withTransaction } = require('../config/db');
const logger = require('../utils/logger');

class AuthController {
  static async register(req, res, next) {
    try {
      const { name, email, mobile, password } = req.body;

      const existingEmail = await UserModel.findByEmail(email);

      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'An account with this email address already exists.',
        });
      }

      const existingMobile = await UserModel.findByMobile(mobile);

      if (existingMobile) {
        return res.status(409).json({
          success: false,
          message: 'An account with this mobile number already exists.',
        });
      }

      const passwordHash = await AuthService.hashPassword(password);

      const registration = await withTransaction(async (client) => {
        const user = await UserModel.create({
          name,
          email,
          mobile,
          passwordHash,
          client,
        });

        const account = await AccountModel.create({
          userId: user.id,
          accountType: 'Savings',
          balance: 50000.00,
          client,
        });

        await TransactionModel.seedInitialTransactions(
          account.id,
          client
        );

        return { user, account };
      });

      const { user } = registration;

      logger.info(
        `User registered successfully: ${user.id} (${user.email})`
      );

      return res.status(201).json({
        success: true,
        message: 'Registration successful! Please login with your credentials.',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const { identifier, password } = req.body;

      const userWithHash =
        await UserModel.findByEmailOrMobile(identifier);

      if (!userWithHash) {
        logger.security(
          'Failed login attempt for non-existent identifier'
        );

        return res.status(401).json({
          success: false,
          message:
            'Invalid credentials. Please verify your email/mobile and password.',
        });
      }

      const isPasswordValid = await AuthService.comparePassword(
        password,
        userWithHash.password_hash
      );

      if (!isPasswordValid) {
        logger.security(
          `Failed login attempt for user: ${userWithHash.id}`
        );

        return res.status(401).json({
          success: false,
          message:
            'Invalid credentials. Please verify your email/mobile and password.',
        });
      }

      const otpResult =
        await OtpService.generateAndSendOtp(userWithHash);

      const challengeToken =
        AuthService.generateOtpChallengeToken(
          userWithHash.id,
          otpResult.otpId,
          otpResult.expiresInSeconds
        );

      return res.status(200).json({
        success: true,
        requiresOtp: true,
        challengeToken,
        message: otpResult.message,
        expiresInSeconds: otpResult.expiresInSeconds,
        cooldownSeconds: otpResult.cooldownSeconds,
      });
    } catch (error) {
      next(error);
    }
  }

  static async verifyOtp(req, res, next) {
    try {
      const { challengeToken, otp } = req.body;

      const challenge =
        AuthService.verifyOtpChallengeToken(challengeToken);

      const user = await UserModel.findById(challenge.userId);

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'User session not found. Please log in again.',
        });
      }

      await OtpService.verifyOtp(
        challenge.userId,
        challenge.otpId,
        otp
      );

      const token = AuthService.generateToken({
        userId: user.id,
        email: user.email,
        name: user.name,
      });

      logger.info(`User authenticated with 2FA: ${user.id}`);

      return res.status(200).json({
        success: true,
        message:
          'Authentication successful. Welcome to your Secure Banking Dashboard.',
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async resendOtp(req, res, next) {
    try {
      const { challengeToken } = req.body;

      const challenge =
        AuthService.verifyOtpChallengeToken(challengeToken);

      const user = await UserModel.findById(challenge.userId);

      if (!user) {
        return res.status(400).json({
          success: false,
          message:
            'User session expired or not found. Please log in again.',
        });
      }

      const otpResult =
        await OtpService.generateAndSendOtp(user, {
          isResend: true,
          otpId: challenge.otpId,
        });

      const nextChallengeToken =
        AuthService.generateOtpChallengeToken(
          user.id,
          otpResult.otpId,
          otpResult.expiresInSeconds
        );

      return res.status(200).json({
        success: true,
        challengeToken: nextChallengeToken,
        message: otpResult.message,
        expiresInSeconds: otpResult.expiresInSeconds,
        cooldownSeconds: otpResult.cooldownSeconds,
      });
    } catch (error) {
      next(error);
    }
  }

  static async logout(req, res, next) {
    try {
      if (req.token) {
        await AuthService.invalidateToken(req.token);
      }

      return res.status(200).json({
        success: true,
        message: 'Logged out successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AuthController;
