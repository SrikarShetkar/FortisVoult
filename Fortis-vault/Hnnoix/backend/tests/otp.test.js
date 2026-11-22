
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const {
  startTestServer,
  stopTestServer,
  apiRequest,
} = require('./testHelper');

const notificationService = require('../services/notificationService');
const { query } = require('../config/db');

describe('Two-Factor Authentication (OTP) Suite', () => {
  let userId;
  let challengeToken;

  const unique = Date.now();

  const testUser = {
    name: 'Priya Sharma',
    email: `priya_${unique}@example.com`,
    mobile: `97${String(unique).slice(-8)}`,
    password: 'SecurePassword@123',
    confirmPassword: 'SecurePassword@123',
  };

  before(async () => {
    await startTestServer();

    const regRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: testUser,
    });

    assert.strictEqual(regRes.status, 201);
    userId = regRes.data.user.id;
  });

  after(async () => {
    await stopTestServer();
  });

  test('1. Successful login starts email delivery without returning the OTP', async () => {
    const loginRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: testUser.email,
        password: testUser.password,
      },
    });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.requiresOtp, true);
    assert.ok(loginRes.data.challengeToken);
    assert.strictEqual(loginRes.data.otp, undefined);
    assert.strictEqual(loginRes.data.devOtp, undefined);

    challengeToken = loginRes.data.challengeToken;

    const dispatched = notificationService.getLastDispatchedOtp();

    assert.ok(dispatched);
    assert.strictEqual(dispatched.otp.length, 6);
    assert.strictEqual(dispatched.recipient, testUser.email);
    assert.match(
      loginRes.data.message,
      /sent to your registered email address/i
    );
  });

  test('2. OTP verification rejects missing or tampered login challenges', async () => {
    const missingChallenge = await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        userId,
        otp: '123456',
      },
    });

    assert.strictEqual(missingChallenge.status, 400);

    const tamperedChallenge = await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        challengeToken: `${challengeToken.slice(0, -1)}x`,
        otp: '123456',
      },
    });

    assert.strictEqual(tamperedChallenge.status, 401);
  });

  test('3. Reject incorrect OTP and decrement remaining attempts', async () => {
    const res = await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        challengeToken,
        otp: '000000',
      },
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /remaining/i);
  });

  test('4. Enforce maximum 3 failed attempts lockout', async () => {
    await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        challengeToken,
        otp: '111111',
      },
    });

    const lockedRes = await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        challengeToken,
        otp: '222222',
      },
    });

    assert.strictEqual(lockedRes.status, 429);
    assert.match(lockedRes.data.message, /maximum attempts/i);
  });

  test('5. Resend OTP creates fresh OTP after previous lock', async () => {
    const previousChallengeToken = challengeToken;

    // PostgreSQL: make the latest OTP older than the resend cooldown.
    const activeOtpResult = await query(
      `SELECT id
       FROM otps
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    assert.ok(activeOtpResult.rows.length > 0);

    const activeOtpId = activeOtpResult.rows[0].id;

    await query(
      `UPDATE otps
       SET created_at = NOW() - INTERVAL '70 seconds'
       WHERE id = $1`,
      [activeOtpId]
    );

    const resendRes = await apiRequest('/api/auth/resend-otp', {
      method: 'POST',
      body: {
        challengeToken,
      },
    });

    assert.strictEqual(resendRes.status, 200);
    assert.strictEqual(resendRes.data.success, true);
    assert.strictEqual(resendRes.data.cooldownSeconds, 60);
    assert.strictEqual(resendRes.data.devOtp, undefined);
    assert.notStrictEqual(
      resendRes.data.challengeToken,
      previousChallengeToken
    );

    challengeToken = resendRes.data.challengeToken;

    const newDispatched = notificationService.getLastDispatchedOtp();

    assert.ok(newDispatched);
    assert.strictEqual(newDispatched.otp.length, 6);
  });

  test('6. Prevent immediate resend if cooldown period is active', async () => {
    const resendImmediate = await apiRequest('/api/auth/resend-otp', {
      method: 'POST',
      body: {
        challengeToken,
      },
    });

    assert.strictEqual(resendImmediate.status, 429);
    assert.match(resendImmediate.data.message, /wait/i);
  });

  test('7. Verify valid OTP, return JWT token and user profile', async () => {
    const validOtp = notificationService.getLastDispatchedOtp().otp;

    const verifyRes = await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        challengeToken,
        otp: validOtp,
      },
    });

    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.data.success, true);
    assert.ok(verifyRes.data.token);
    assert.strictEqual(verifyRes.data.user.name, testUser.name);
  });

  test('8. Prevent OTP reuse after successful verification', async () => {
    const usedOtp = notificationService.getLastDispatchedOtp().otp;

    const reuseRes = await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        challengeToken,
        otp: usedOtp,
      },
    });

    assert.strictEqual(reuseRes.status, 400);
    assert.strictEqual(reuseRes.data.success, false);
    assert.match(reuseRes.data.message, /already been used/i);
  });

  test('9. Reject expired OTP', async () => {
    const loginRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: testUser.email,
        password: testUser.password,
      },
    });

    assert.strictEqual(loginRes.status, 200);
    challengeToken = loginRes.data.challengeToken;

    const activeOtpResult = await query(
      `SELECT id
       FROM otps
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    assert.ok(activeOtpResult.rows.length > 0);

    const activeOtpId = activeOtpResult.rows[0].id;
    const activeOtp = notificationService.getLastDispatchedOtp().otp;

    await query(
      `UPDATE otps
       SET expires_at = NOW() - INTERVAL '1 minute'
       WHERE id = $1`,
      [activeOtpId]
    );

    const expiredRes = await apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        challengeToken,
        otp: activeOtp,
      },
    });

    assert.strictEqual(expiredRes.status, 400);
    assert.match(expiredRes.data.message, /expired/i);
  });
});
