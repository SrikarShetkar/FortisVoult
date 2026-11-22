
const AccountModel = require('../models/accountModel');
const TransactionModel = require('../models/transactionModel');
const { withTransaction } = require('../config/db');
const { formatCurrency } = require('../utils/helpers');

class TransactionController {
  static async getTransactions(req, res, next) {
    try {
      const account = await AccountModel.findByUserId(req.user.id);

      if (!account) {
        return res.status(404).json({
          success: false,
          message: 'Account not found.',
        });
      }

      const rawTransactions = await TransactionModel.findByAccountId(
        account.id,
        50
      );

      const formatted = rawTransactions.map((tx) => {
        const isCredit = tx.type === 'CREDIT';
        const dateObj = new Date(tx.transactionDate);

        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();

        return {
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          formattedAmount: `${isCredit ? '+' : '-'}${formatCurrency(tx.amount)}`,
          description: tx.description,
          transactionDate: tx.transactionDate,
          formattedDate: `${day}/${month}/${year}`,
        };
      });

      return res.status(200).json({
        success: true,
        count: formatted.length,
        transactions: formatted,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Simulate a deposit or debit.
   * Balance update and transaction insertion are atomic.
   */
  static async simulateTransaction(req, res, next) {
    try {
      const { type, amount, description } = req.body;

      if (!type || !['CREDIT', 'DEBIT'].includes(type)) {
        return res.status(400).json({
          success: false,
          message: 'Transaction type must be CREDIT or DEBIT.',
        });
      }

      // Validate amount and restrict it to two decimal places.
      const amountString = String(amount ?? '');

      if (!/^\d+(\.\d{1,2})?$/.test(amountString)) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be a positive number with at most two decimal places.',
        });
      }

      const numericAmount = Number(amountString);

      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be a positive number.',
        });
      }

      if (
        typeof description !== 'string' ||
        description.trim().length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: 'Description is required.',
        });
      }

      // Work in integer paise to avoid floating-point arithmetic
      // when calculating the new balance.
      const amountInPaise = Math.round(numericAmount * 100);

      const result = await withTransaction(async (client) => {
        // Lock the account row to prevent concurrent balance updates.
        const accountResult = await client.query(
          `SELECT id, user_id, balance
           FROM accounts
           WHERE user_id = $1
           FOR UPDATE`,
          [req.user.id]
        );

        if (accountResult.rows.length === 0) {
          const error = new Error('Account not found.');
          error.statusCode = 404;
          throw error;
        }

        const account = accountResult.rows[0];

        const currentBalanceInPaise = Math.round(
          Number(account.balance) * 100
        );

        if (
          type === 'DEBIT' &&
          currentBalanceInPaise < amountInPaise
        ) {
          const error = new Error(
            'Insufficient balance for this transaction.'
          );
          error.statusCode = 400;
          throw error;
        }

        const newBalanceInPaise =
          type === 'CREDIT'
            ? currentBalanceInPaise + amountInPaise
            : currentBalanceInPaise - amountInPaise;

        const newBalance = newBalanceInPaise / 100;

        // Update account balance using the same transaction client.
        await AccountModel.updateBalance(
          account.id,
          newBalance,
          client
        );

        // Insert transaction using the same transaction client.
        const newTx = await TransactionModel.create({
          accountId: account.id,
          type,
          amount: numericAmount,
          description: description.trim(),
          transactionDate: new Date().toISOString(),
          client,
        });

        return {
          newBalance,
          transaction: newTx,
        };
      });

      return res.status(201).json({
        success: true,
        message: `Simulated ${type.toLowerCase()} of ${formatCurrency(numericAmount)} processed successfully.`,
        newBalance: result.newBalance,
        formattedNewBalance: formatCurrency(result.newBalance),
        transaction: result.transaction,
      });
    } catch (error) {
      if (error.statusCode === 400 || error.statusCode === 404) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }

      next(error);
    }
  }
}

module.exports = TransactionController;
