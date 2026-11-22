
process.env.NODE_ENV = 'test';

const {
  startTestServer,
  stopTestServer,
  apiRequest,
} = require('./testHelper');

const notificationService = require('../services/notificationService');

async function runE2E() {
  console.log('\n--- STARTING COMPREHENSIVE END-TO-END VERIFICATION ---');

  try {
    await startTestServer();

    console.log('\n[E2E] PostgreSQL test server started.');

    // 1. Health check
    console.log('\nStep 1: Testing Health Endpoint...');

    const healthRes = await apiRequest('/api/health');

    if (healthRes.status !== 200) {
      throw new Error('Health check failed');
    }

    console.log(`[PASS] Health check: ${healthRes.status}`);

    // 2. Frontend static serving
    console.log('\nStep 2: Testing Frontend Static Serving...');

    const frontendRes = await apiRequest('/');

    if (frontendRes.status === 200) {
      console.log('[PASS] Frontend root endpoint responded successfully.');
    } else {
      console.log(
        '[INFO] Frontend build is not being served by the backend. This is expected when deploying frontend separately.'
      );
    }

    // 3. Registration
    console.log('\nStep 3: Testing User Registration...');

    const unique = Date.now();

    const testUser = {
      name: 'Aditya Verma',
      email: `e2e_student_${unique}@example.com`,
      mobile: `98${String(unique).slice(-8)}`,
      password: 'SecurePass@2026',
      confirmPassword: 'SecurePass@2026',
    };

    const regRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: testUser,
    });

    if (regRes.status !== 201) {
      throw new Error(`Registration failed: ${JSON.stringify(regRes.data)}`);
    }

    console.log(`[PASS] Registration: ${regRes.status}`);

    // 4. Login
    console.log('\nStep 4: Testing Login (Stage 1 of 2FA)...');

    const loginRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: testUser.email,
        password: testUser.password,
      },
    });

    if (loginRes.status !== 200 || !loginRes.data.challengeToken) {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.data)}`);
    }

    console.log(`[PASS] Login: ${loginRes.status}`);

    const dispatched = notificationService.getLastDispatchedOtp();

    if (!dispatched || !dispatched.otp) {
      throw new Error('Test OTP was not captured.');
    }

    console.log('[PASS] Test OTP captured by notification service.');

    // 5. OTP verification
    console.log('\nStep 5: Testing OTP Verification...');

    const verifyRes = await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        challengeToken: loginRes.data.challengeToken,
        otp: dispatched.otp,
      },
    });

    if (verifyRes.status !== 200 || !verifyRes.data.token) {
      throw new Error(`OTP verification failed: ${JSON.stringify(verifyRes.data)}`);
    }

    const token = verifyRes.data.token;

    console.log('[PASS] OTP verified and JWT issued.');

    const authHeaders = {
      Authorization: `Bearer ${token}`,
    };

    // 6. Account
    console.log('\nStep 6: Testing Account Endpoint...');

    const accountRes = await apiRequest('/api/account', {
      headers: authHeaders,
    });

    if (accountRes.status !== 200) {
      throw new Error(`Account request failed: ${JSON.stringify(accountRes.data)}`);
    }

    console.log(
      `[PASS] Account: ${accountRes.data.account.accountNumberMasked}`
    );

    // 7. Transactions
    console.log('\nStep 7: Testing Transactions Endpoint...');

    const transactionsRes = await apiRequest('/api/transactions', {
      headers: authHeaders,
    });

    if (
      transactionsRes.status !== 200 ||
      !Array.isArray(transactionsRes.data.transactions)
    ) {
      throw new Error('Transaction retrieval failed.');
    }

    console.log(
      `[PASS] Retrieved ${transactionsRes.data.transactions.length} transactions.`
    );

    // 8. User profile
    console.log('\nStep 8: Testing User Profile...');

    const profileRes = await apiRequest('/api/user/profile', {
      headers: authHeaders,
    });

    if (profileRes.status !== 200) {
      throw new Error('User profile retrieval failed.');
    }

    console.log(`[PASS] Profile: ${profileRes.data.user.name}`);

    // 9. Simulated transaction
    console.log('\nStep 9: Testing Simulated Transaction...');

    const transactionRes = await apiRequest('/api/transactions/simulate', {
      method: 'POST',
      headers: authHeaders,
      body: {
        type: 'CREDIT',
        amount: 7500,
        description: 'E2E Test Transaction',
      },
    });

    if (transactionRes.status !== 201) {
      throw new Error(
        `Transaction simulation failed: ${JSON.stringify(transactionRes.data)}`
      );
    }

    console.log(
      `[PASS] Transaction created. New balance: ${transactionRes.data.newBalance}`
    );

    // 10. Logout
    console.log('\nStep 10: Testing Logout...');

    const logoutRes = await apiRequest('/api/auth/logout', {
      method: 'POST',
      headers: authHeaders,
    });

    if (logoutRes.status !== 200) {
      throw new Error('Logout failed.');
    }

    const postLogoutRes = await apiRequest('/api/account', {
      headers: authHeaders,
    });

    if (postLogoutRes.status !== 401) {
      throw new Error('Revoked JWT was still accepted.');
    }

    console.log('[PASS] Logout and token revocation verified.');

    console.log('\n==============================================');
    console.log('  ALL E2E CHECKS PASSED');
    console.log('==============================================\n');
  } finally {
    await stopTestServer();
  }
}

runE2E().catch((error) => {
  console.error('\n[E2E FAILED]', error);
  process.exitCode = 1;
});
