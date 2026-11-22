
const crypto = require('crypto');
const { query } = require('../config/db');
const { generateAccountNumber } = require('../utils/helpers');

class AccountModel {
  static mapAccount(row) {
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      accountNumber: row.account_number,
      accountType: row.account_type,
      balance: Number(row.balance),
      createdAt: row.created_at,
    };
  }

  static async create({
    userId,
    accountNumber,
    accountType = 'Savings',
    balance = 50000.00,
    client = null,
  }) {
    const executor = client || { query };

    const id = crypto.randomUUID();
    const accNumber = accountNumber || generateAccountNumber();
    const now = new Date();

    const result = await executor.query(
      `INSERT INTO accounts (
        id,
        user_id,
        account_number,
        account_type,
        balance,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        user_id,
        account_number,
        account_type,
        balance,
        created_at`,
      [id, userId, accNumber, accountType, balance, now]
    );

    return this.mapAccount(result.rows[0]);
  }

  static async findById(id) {
    const result = await query(
      `SELECT
        id,
        user_id,
        account_number,
        account_type,
        balance,
        created_at
       FROM accounts
       WHERE id = $1`,
      [id]
    );

    return this.mapAccount(result.rows[0]);
  }

  static async findByUserId(userId) {
    const result = await query(
      `SELECT
        id,
        user_id,
        account_number,
        account_type,
        balance,
        created_at
       FROM accounts
       WHERE user_id = $1`,
      [userId]
    );

    return this.mapAccount(result.rows[0]);
  }

  static async updateBalance(accountId, newBalance, client = null) {
    const executor = client || { query };

    const result = await executor.query(
      `UPDATE accounts
       SET balance = $1
       WHERE id = $2
       RETURNING
         id,
         user_id,
         account_number,
         account_type,
         balance,
         created_at`,
      [newBalance, accountId]
    );

    return this.mapAccount(result.rows[0]);
  }
}

module.exports = AccountModel;
