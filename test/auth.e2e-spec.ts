import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, MockMailService, truncateTables } from './test-setup';

const ORIGIN = 'http://localhost:3000';

const TEST_USER = {
  email: 'test@example.com',
  password: 'TestPass1',
  firstName: 'Test',
  lastName: 'User',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let mockMail: MockMailService;
  let accessToken: string;
  let refreshCookie: string;

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail);
  });

  afterAll(async () => {
    await truncateTables(app);
    await app.close();
  });

  function authGet(path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  function authPost(path: string, body?: Record<string, unknown>) {
    const req = request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN);
    return body ? req.send(body) : req;
  }

  function publicPost(path: string, body?: Record<string, unknown>) {
    const req = request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Origin', ORIGIN);
    return body ? req.send(body) : req;
  }

  // ─── Registration ───────────────────────────────

  describe('POST /auth/register', () => {
    it('should register a new user', async () => {
      const res = await publicPost('/auth/register', TEST_USER).expect(201);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.email).toBe(TEST_USER.email);
      expect(res.body.user.firstName).toBe(TEST_USER.firstName);
      expect(res.body.user.emailVerified).toBe(false);
      expect(res.body.user.id).toBeDefined();

      accessToken = res.body.accessToken;

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      refreshCookie = Array.isArray(cookies) ? cookies[0] : cookies;
      expect(refreshCookie).toContain('ritora_refresh');
    });

    it('should reject duplicate email', async () => {
      await publicPost('/auth/register', TEST_USER).expect(409);
    });

    it('should reject without terms accepted', async () => {
      await publicPost('/auth/register', {
        ...TEST_USER,
        email: 'other@example.com',
        termsAccepted: false,
      }).expect(400);
    });

    it('should reject without Origin header', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...TEST_USER, email: 'noorigin@example.com' })
        .expect(403);
    });
  });

  // ─── Current User ───────────────────────────────

  describe('GET /auth/me', () => {
    it('should return the current user', async () => {
      const res = await authGet('/auth/me').expect(200);

      expect(res.body.email).toBe(TEST_USER.email);
      expect(res.body.firstName).toBe(TEST_USER.firstName);
    });

    it('should reject without auth token', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });
  });

  // ─── Sessions ───────────────────────────────────

  describe('GET /auth/sessions', () => {
    it('should list active sessions', async () => {
      const res = await authGet('/auth/sessions').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].id).toBeDefined();
      expect(res.body[0].createdAt).toBeDefined();
    });
  });

  // ─── Email Verification ─────────────────────────

  describe('POST /auth/verify-email', () => {
    it('should reject invalid token', async () => {
      await publicPost('/auth/verify-email', {
        token: 'invalid-token',
      }).expect(400);
    });

    it('should verify email with valid token', async () => {
      const token = mockMail.getVerificationToken(TEST_USER.email);
      expect(token).toBeDefined();

      await publicPost('/auth/verify-email', { token }).expect(200);

      const res = await authGet('/auth/me').expect(200);
      expect(res.body.emailVerified).toBe(true);
    });
  });

  // ─── Resend Verification ────────────────────────

  describe('POST /auth/resend-verification', () => {
    it('should always return 200', async () => {
      const res = await publicPost('/auth/resend-verification', {
        email: 'nonexistent@example.com',
      }).expect(200);

      expect(res.body.message).toBeDefined();
    });
  });

  // ─── Login ──────────────────────────────────────

  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: TEST_USER.password,
      }).expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.email).toBe(TEST_USER.email);

      accessToken = res.body.accessToken;

      const cookies = res.headers['set-cookie'];
      refreshCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    });

    it('should reject invalid password', async () => {
      const res = await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: 'WrongPass1',
      }).expect(401);

      expect(res.body.message).toBe('Invalid credentials');
    });

    it('should reject non-existent email', async () => {
      await publicPost('/auth/login', {
        email: 'nobody@example.com',
        password: TEST_USER.password,
      }).expect(401);
    });
  });

  // ─── Token Refresh ──────────────────────────────

  describe('POST /auth/refresh', () => {
    it('should refresh tokens with valid cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', ORIGIN)
        .set('Cookie', refreshCookie)
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      accessToken = res.body.accessToken;

      const cookies = res.headers['set-cookie'];
      refreshCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    });

    it('should reject without cookie', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', ORIGIN)
        .expect(401);
    });
  });

  // ─── Forgot / Reset Password ────────────────────

  describe('Password reset flow', () => {
    const newPassword = 'NewPass1!';

    it('should send forgot password email', async () => {
      const res = await publicPost('/auth/forgot-password', {
        email: TEST_USER.email,
      }).expect(200);

      expect(res.body.message).toBeDefined();
      expect(mockMail.getResetToken(TEST_USER.email)).toBeDefined();
    });

    it('should always return 200 for non-existent email', async () => {
      await publicPost('/auth/forgot-password', {
        email: 'nobody@example.com',
      }).expect(200);
    });

    it('should reject invalid reset token', async () => {
      await publicPost('/auth/reset-password', {
        token: 'bad-token',
        newPassword,
      }).expect(400);
    });

    it('should reset password with valid token', async () => {
      const token = mockMail.getResetToken(TEST_USER.email);
      expect(token).toBeDefined();

      await publicPost('/auth/reset-password', {
        token,
        newPassword,
      }).expect(200);
    });

    it('should login with new password', async () => {
      const res = await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: newPassword,
      }).expect(200);

      accessToken = res.body.accessToken;

      const cookies = res.headers['set-cookie'];
      refreshCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    });

    it('should reject old password', async () => {
      await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: TEST_USER.password,
      }).expect(401);
    });
  });

  // ─── Data Export ────────────────────────────────

  describe('POST /auth/export', () => {
    it('should export user data with password confirmation', async () => {
      const res = await authPost('/auth/export', {
        password: 'NewPass1!',
      }).expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(TEST_USER.email);
      expect(res.body).toHaveProperty('skinProfile');
      expect(res.body.consents).toBeDefined();
      expect(Array.isArray(res.body.consents)).toBe(true);
      expect(res.body.sessions).toBeDefined();
    });

    it('should reject with wrong password', async () => {
      await authPost('/auth/export', { password: 'wrong' }).expect(401);
    });
  });

  // ─── Logout ─────────────────────────────────────

  describe('Logout', () => {
    it('should logout current session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', refreshCookie)
        .expect(200);

      expect(res.body.message).toBe('Logged out');
    });

    it('should login again for logout-all test', async () => {
      const res = await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: 'NewPass1!',
      }).expect(200);

      accessToken = res.body.accessToken;

      const cookies = res.headers['set-cookie'];
      refreshCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    });

    it('should logout all sessions', async () => {
      const res = await authPost('/auth/logout-all').expect(200);

      expect(res.body.message).toBe('All sessions revoked');
    });
  });

  // ─── Account Deletion ──────────────────────────

  describe('DELETE /auth/account', () => {
    it('should login for deletion test', async () => {
      const res = await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: 'NewPass1!',
      }).expect(200);

      accessToken = res.body.accessToken;
    });

    it('should reject with wrong password', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: 'wrong' })
        .expect(401);
    });

    it('should delete account with correct password', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: 'NewPass1!' })
        .expect(200);

      expect(res.body.message).toBe('Account deleted');
    });

    it('should reject login after deletion', async () => {
      await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: 'NewPass1!',
      }).expect(401);
    });
  });
});
