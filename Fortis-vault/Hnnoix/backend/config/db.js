
const { Pool } = require('pg');
const config = require('./env');

let pool = null;
let initializationPromise = null;

function getDb() {
  if (pool) return pool;

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error:', error);
  });

  return pool;
}

async function query(text, params = []) {
  return getDb().query(text, params);
}

async function withTransaction(callback) {
  const client = await getDb().connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('PostgreSQL rollback error:', rollbackError);
    }

    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const db = getDb();

    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        mobile TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        account_number TEXT NOT NULL UNIQUE,
        account_type TEXT NOT NULL,
        balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
        amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
        description TEXT NOT NULL,
        transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS otps (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        otp_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS revoked_tokens (
        jti TEXT PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_email
        ON users(email);

      CREATE INDEX IF NOT EXISTS idx_users_mobile
        ON users(mobile);

      CREATE INDEX IF NOT EXISTS idx_accounts_user_id
        ON accounts(user_id);

      CREATE INDEX IF NOT EXISTS idx_transactions_account_id
        ON transactions(account_id);

      CREATE INDEX IF NOT EXISTS idx_otps_user_id
        ON otps(user_id);

      CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at
        ON revoked_tokens(expires_at);
    `;

    await db.query(schema);

    console.log('Neon PostgreSQL database initialized successfully.');
  })();

  try {
    await initializationPromise;
  } catch (error) {
    initializationPromise = null;
    throw error;
  }
}

async function closeDb() {
  if (pool) {
    const currentPool = pool;
    pool = null;
    initializationPromise = null;

    await currentPool.end();

    console.log('PostgreSQL connection pool closed.');
  }
}

module.exports = {
  getDb,
  query,
  withTransaction,
  initDb,
  closeDb,
};
