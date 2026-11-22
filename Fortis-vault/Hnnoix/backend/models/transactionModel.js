
const crypto = require('crypto');
const { query } = require('../config/db');

class TransactionModel {
  static mapTransaction(row) {
    if (!row) return null;

    return {
      id: row.id,
      accountId: row.account_id,
      type: row.type,
      amount: Number(row.amount),
      description: row.description,
      transactionDate: row.transaction_date,
    };
  }

  static async create({
    accountId,
    type,
    amount,
    description,
    transactionDate,
    client = null,
  }) {
    const executor = client || { query };
    const id = crypto.randomUUID();
    const date = transactionDate || new Date();

    const result = await executor.query(
      `INSERT INTO transactions (
        id,
        account_id,
        type,
        amount,
        description,
        transaction_date
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        account_id,
        type,
        amount,
        description,
        transaction_date`,
      [id, accountId, type, amount, description, date]
    );

    return this.mapTransaction(result.rows[0]);
  }

  static async findById(id) {
    const result = await query(
      `SELECT
        id,
        account_id,
        type,
        amount,
        description,
        transaction_date
       FROM transactions
       WHERE id = $1`,
      [id]
    );

    return this.mapTransaction(result.rows[0]);
  }

  static async findByAccountId(accountId, limit = 50) {
    const safeLimit = Math.max(
      1,
      Math.min(100, Math.floor(Number(limit) || 50))
    );

    const result = await query(
      `SELECT
        id,
        account_id,
        type,
        amount,
        description,
        transaction_date
       FROM transactions
       WHERE account_id = $1
       ORDER BY transaction_date DESC, id DESC
       LIMIT $2`,
      [accountId, safeLimit]
    );

    return result.rows.map((row) => this.mapTransaction(row));
  }

  /**
   * Seeds standard simulated transactions
   * for a newly registered account.
   */
  static async seedInitialTransactions(accountId, client = null) {
    const initialTxs = [
      {
        type: 'CREDIT',
        amount: 30000.00,
        description: 'Monthly Salary Transfer',
        transactionDate: '2026-10-01T09:30:00.000Z',
      },
      {
        type: 'DEBIT',
        amount: 2500.00,
        description: 'Online Shopping - Electronics',
        transactionDate: '2026-09-30T14:15:00.000Z',
      },
      {
        type: 'DEBIT',
        amount: 1200.00,
        description: 'Electricity Bill Payment',
        transactionDate: '2026-09-28T18:45:00.000Z',
      },
      {
        type: 'CREDIT',
        amount: 5000.00,
        description: 'UPI Transfer from Colleague',
        transactionDate: '2026-09-25T11:20:00.000Z',
      },
      {
        type: 'DEBIT',
        amount: 850.00,
        description: 'Grocery Store Payment',
        transactionDate: '2026-09-20T16:05:00.000Z',
      },
    ];

    const transactions = [];

    for (const tx of initialTxs) {
      const created = await this.create({
        accountId,
        type: tx.type,
        amount: tx.amount,
        description: tx.description,
        transactionDate: tx.transactionDate,
        client,
      });

      transactions.push(created);
    }

    return transactions;
  }
}

module.exports = TransactionModel;
