
const crypto = require('crypto');
const { query } = require('../config/db');

class UserModel {
  static async create({
    name,
    email,
    mobile,
    passwordHash,
    client = null,
  }) {
    const executor = client || { query };

    const id = crypto.randomUUID();
    const now = new Date();

    const result = await executor.query(
      `INSERT INTO users (
        id,
        name,
        email,
        mobile,
        password_hash,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        name,
        email,
        mobile,
        created_at,
        updated_at`,
      [
        id,
        name.trim(),
        email.trim().toLowerCase(),
        mobile.trim(),
        passwordHash,
        now,
        now,
      ]
    );

    return result.rows[0] || null;
  }

  static async findById(id) {
    const result = await query(
      `SELECT
        id,
        name,
        email,
        mobile,
        created_at,
        updated_at
       FROM users
       WHERE id = $1`,
      [id]
    );

    return result.rows[0] || null;
  }

  static async findByIdWithHash(id) {
    const result = await query(
      `SELECT
        id,
        name,
        email,
        mobile,
        password_hash,
        created_at,
        updated_at
       FROM users
       WHERE id = $1`,
      [id]
    );

    return result.rows[0] || null;
  }

  static async findByEmail(email) {
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    return result.rows[0] || null;
  }

  static async findByMobile(mobile) {
    const result = await query(
      'SELECT * FROM users WHERE mobile = $1',
      [mobile.trim()]
    );

    return result.rows[0] || null;
  }

  static async findByEmailOrMobile(identifier) {
    const cleanId = identifier.trim().toLowerCase();

    const result = await query(
      `SELECT *
       FROM users
       WHERE email = $1 OR mobile = $2`,
      [cleanId, identifier.trim()]
    );

    return result.rows[0] || null;
  }
}

module.exports = UserModel;
