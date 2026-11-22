
// Test environment must be configured before importing the application.
process.env.NODE_ENV = 'test';

const http = require('http');
const app = require('../server');
const config = require('../config/env');
const { initDb, closeDb } = require('../config/db');

let testServer = null;
let baseUrl = '';

async function startTestServer() {
  if (testServer) return baseUrl;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Test DATABASE_URL is missing. Configure a separate test database before running tests.'
    );
  }

  if (config.nodeEnv !== 'test') {
    throw new Error('Tests must run with NODE_ENV=test.');
  }

  await initDb();

  try {
    await new Promise((resolve, reject) => {
      testServer = http.createServer(app);

      testServer.once('error', reject);

      testServer.listen(0, '127.0.0.1', () => {
        const port = testServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    return baseUrl;
  } catch (error) {
    testServer = null;
    await closeDb();
    throw error;
  }
}

async function stopTestServer() {
  if (testServer) {
    await new Promise((resolve, reject) => {
      testServer.close((error) => {
        if (error) return reject(error);
        resolve();
      });
    });

    testServer = null;
    baseUrl = '';
  }

  await closeDb();
}

async function apiRequest(endpoint, options = {}) {
  if (!baseUrl) {
    throw new Error('Test server is not running.');
  }

  const url = `${baseUrl}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    data,
  };
}

module.exports = {
  startTestServer,
  stopTestServer,
  apiRequest,
};
