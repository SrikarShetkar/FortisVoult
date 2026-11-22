
const crypto = require('crypto');
const { query } = require('../config/db');

class OtpModel {
  static mapOtp(row) {
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      otpHash: row.otp_hash,
      expiresAt: row.expires_at,
      attempts: row.attempts,
      verified: row.verified,
      createdAt: row.created_at,
    };
  }

  static async create({ userId, otpHash, expiresAt, client = null }) {
    const executor = client || { query };
    const id = crypto.randomUUID();

    const result = await executor.query(
      `INSERT INTO otps (
        id, user_id, otp_hash, expires_at,
        attempts, verified, created_at
      )
      VALUES ($1, $2, $3, $4, 0, FALSE, NOW())
      RETURNING *`,
      [id, userId, otpHash, expiresAt]
    );

    return this.mapOtp(result.rows[0]);
  }

  static async findById(id, client = null) {
    const executor = client || { query };

    const result = await executor.query(
      `SELECT *
       FROM otps
       WHERE id = $1`,
      [id]
    );

    return this.mapOtp(result.rows[0]);
  }

  static async getLatestOtpForUser(userId, client = null) {
    const executor = client || { query };

    const result = await executor.query(
      `SELECT *
       FROM otps
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId]
    );

    return this.mapOtp(result.rows[0]);
  }

  static async incrementAttempts(id, client = null) {
    const executor = client || { query };

    const result = await executor.query(
      `UPDATE otps
       SET attempts = attempts + 1
       WHERE id = $1
         AND verified = FALSE
         AND expires_at > NOW()
       RETURNING *`,
      [id]
    );

    return this.mapOtp(result.rows[0]);
  }

  static async markVerified(id, client = null) {
    const executor = client || { query };

    const result = await executor.query(
      `UPDATE otps
       SET verified = TRUE
       WHERE id = $1
         AND verified = FALSE
       RETURNING *`,
      [id]
    );

    return this.mapOtp(result.rows[0]);
  }

  static async invalidateUserOtps(userId, client = null) {
    const executor = client || { query };

    await executor.query(
      `UPDATE otps
       SET verified = TRUE
       WHERE user_id = $1
         AND verified = FALSE`,
      [userId]
    );
  }
}

module.exports = OtpModel;
