import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import { closeTestApp, createTestApp, MockMailService } from './test-setup';

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
  let app: INestApplication;
  let mockMail: MockMailService;
  let accessToken: string;
  let refreshCookie: string;
  let currentPassword = TEST_USER.password;

  function getAccessTokenFromResponse(res: request.Response): string {
    const body = res.body as { accessToken?: unknown };

    if (typeof body.accessToken !== 'string') {
      throw new Error('Auth response did not include a string accessToken');
    }

    return body.accessToken;
  }

  function getFirstSetCookieHeader(res: request.Response): string {
    const headers = res.headers as Record<string, unknown>;
    const cookies = headers['set-cookie'];

    if (Array.isArray(cookies) && typeof cookies[0] === 'string') {
      return cookies[0];
    }

    if (typeof cookies === 'string') {
      return cookies;
    }

    throw new Error('Auth response did not include a set-cookie header');
  }

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail);
  });

  afterAll(async () => {
    await closeTestApp(app);
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

  function authPatch(path: string, body?: Record<string, unknown>) {
    const req = request(app.getHttpServer())
      .patch(`/api/v1${path}`)
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

  function authGetWithToken(path: string, token: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function refreshWithCookie(cookie: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie);
  }

  function storeSessionFromAuthResponse(res: request.Response): void {
    accessToken = getAccessTokenFromResponse(res);
    refreshCookie = getFirstSetCookieHeader(res);
    expect(refreshCookie).toContain('ritora_refresh');
  }

  function getSessionStateFromAuthResponse(res: request.Response): {
    accessToken: string;
    refreshCookie: string;
  } {
    const cookie = getFirstSetCookieHeader(res);
    expect(cookie).toContain('ritora_refresh');

    return {
      accessToken: getAccessTokenFromResponse(res),
      refreshCookie: cookie,
    };
  }

  function getSessionIdFromCookie(cookie: string): string {
    const cookiePair = cookie.split(';')[0];
    const value = cookiePair.split('=')[1] ?? '';
    const dotIndex = value.indexOf('.');

    if (dotIndex === -1) {
      throw new Error('Refresh cookie did not include session id');
    }

    return value.slice(0, dotIndex);
  }

  async function loginAndStoreSession(password = TEST_USER.password) {
    const res = await publicPost('/auth/login', {
      email: TEST_USER.email,
      password,
    }).expect(200);

    storeSessionFromAuthResponse(res);
    return res;
  }

  async function loginSession(password = currentPassword) {
    const res = await publicPost('/auth/login', {
      email: TEST_USER.email,
      password,
    }).expect(200);

    return getSessionStateFromAuthResponse(res);
  }

  describe('POST /auth/register', () => {
    it('should register a new user without creating a session', async () => {
      const res = await publicPost('/auth/register', TEST_USER).expect(201);

      expect(res.body.message).toBe(
        'Verify your email to activate your account',
      );
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.user.email).toBe(TEST_USER.email);
      expect(res.body.user.firstName).toBe(TEST_USER.firstName);
      expect(res.body.user.emailVerified).toBe(false);
      expect(res.body.user.id).toBeDefined();
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('should reject duplicate email', async () => {
      await publicPost('/auth/register', TEST_USER).expect(409);
    });

    it('should reject email aliases as already registered', async () => {
      const res = await publicPost('/auth/register', {
        ...TEST_USER,
        email: 'test+promo@example.com',
      }).expect(409);

      expect(res.body.message).toBe('Email already in use');
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

  describe('Protected routes before verification/login', () => {
    it('should reject login before email verification', async () => {
      const res = await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: TEST_USER.password,
      }).expect(403);

      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(res.body.message).toBe('Email not verified');
    });

    it('should reject /auth/me without auth token', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('should reject /auth/sessions without auth token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .expect(401);
    });
  });

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
    });
  });

  describe('POST /auth/resend-verification', () => {
    it('should always return 200', async () => {
      const res = await publicPost('/auth/resend-verification', {
        email: 'nonexistent@example.com',
      }).expect(200);

      expect(res.body.message).toBeDefined();
    });
  });

  describe('POST /auth/login', () => {
    it('should login with valid credentials after verification', async () => {
      const res = await loginAndStoreSession();

      expect(res.body.user.email).toBe(TEST_USER.email);
      expect(res.body.user.emailVerified).toBe(true);
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

  describe('Authenticated routes', () => {
    it('should return the current user', async () => {
      const res = await authGet('/auth/me').expect(200);

      expect(res.body.email).toBe(TEST_USER.email);
      expect(res.body.firstName).toBe(TEST_USER.firstName);
      expect(res.body.emailVerified).toBe(true);
    });

    it('should return the current user through /users/me', async () => {
      const res = await authGet('/users/me').expect(200);

      expect(res.body.email).toBe(TEST_USER.email);
      expect(res.body.firstName).toBe(TEST_USER.firstName);
      expect(res.body.lastName).toBe(TEST_USER.lastName);
    });

    it('should update the current user profile', async () => {
      const res = await authPatch('/users/me', {
        firstName: 'Ada',
        lastName: 'Lovelace',
      }).expect(200);

      expect(res.body.firstName).toBe('Ada');
      expect(res.body.lastName).toBe('Lovelace');
    });

    it('should reject invalid profile payloads', async () => {
      await authPatch('/users/me', {
        firstName: '  ',
        lastName: 'Lovelace',
      }).expect(400);
    });

    it('should list active sessions', async () => {
      const res = await authGet('/auth/sessions').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].id).toBeDefined();
      expect(res.body[0].createdAt).toBeDefined();
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh tokens with valid cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', ORIGIN)
        .set('Cookie', refreshCookie)
        .expect(200);

      accessToken = getAccessTokenFromResponse(res);
      refreshCookie = getFirstSetCookieHeader(res);
      expect(refreshCookie).toContain('ritora_refresh');
    });

    it('should reject without cookie', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', ORIGIN)
        .expect(401);
    });
  });

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
      currentPassword = newPassword;
    });

    it('should login with new password', async () => {
      await loginAndStoreSession(newPassword);
    });

    it('should reject old password', async () => {
      await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: TEST_USER.password,
      }).expect(401);
    });
  });

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

  describe('Session revocation', () => {
    let sessionA: { accessToken: string; refreshCookie: string };
    let sessionB: { accessToken: string; refreshCookie: string };

    it('should keep other sessions active when logging out from the current device', async () => {
      sessionA = await loginSession();
      sessionB = await loginSession();

      const sessionAId = getSessionIdFromCookie(sessionA.refreshCookie);
      const sessionBId = getSessionIdFromCookie(sessionB.refreshCookie);

      const logoutRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${sessionA.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', sessionA.refreshCookie)
        .expect(200);

      expect(logoutRes.body.message).toBe('Logged out');

      await authGetWithToken('/auth/me', sessionA.accessToken).expect(401);
      await refreshWithCookie(sessionA.refreshCookie).expect(401);

      const refreshRes = await refreshWithCookie(sessionB.refreshCookie).expect(
        200,
      );
      sessionB = getSessionStateFromAuthResponse(refreshRes);
      accessToken = sessionB.accessToken;
      refreshCookie = sessionB.refreshCookie;

      const sessionsRes = await authGetWithToken(
        '/auth/sessions',
        sessionB.accessToken,
      ).expect(200);

      expect(Array.isArray(sessionsRes.body)).toBe(true);
      expect(
        sessionsRes.body.some(
          (session: { id: string }) => session.id === sessionAId,
        ),
      ).toBe(false);
      expect(
        sessionsRes.body.some(
          (session: { id: string }) => session.id === sessionBId,
        ),
      ).toBe(true);
    });

    it('should revoke every active session when logging out from all devices', async () => {
      const sessionC = await loginSession();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${sessionB.accessToken}`)
        .set('Origin', ORIGIN)
        .set('Cookie', sessionB.refreshCookie)
        .expect(200);

      expect(res.body.message).toBe('All sessions revoked');

      await refreshWithCookie(sessionB.refreshCookie).expect(401);
      await refreshWithCookie(sessionC.refreshCookie).expect(401);

      await authGetWithToken('/auth/sessions', sessionB.accessToken).expect(
        401,
      );
    });
  });

  describe('DELETE /auth/account', () => {
    it('should login for deletion test', async () => {
      await loginAndStoreSession(currentPassword);
    });

    it('should reject with wrong password', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Origin', ORIGIN)
        .send({ password: 'wrong' })
        .expect(401);
    });

    it('should schedule deletion, revoke sessions, and reserve the email', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Origin', ORIGIN)
        .send({ password: currentPassword })
        .expect(200);

      expect(res.body.status).toBe('scheduled');
      expect(res.body.message).toBe('Account deletion scheduled');
      expect(typeof res.body.scheduledFor).toBe('string');
      expect(getFirstSetCookieHeader(res)).toContain('ritora_refresh=;');
      expect(mockMail.getDeletionCancelToken(TEST_USER.email)).toBeDefined();

      await authGet('/auth/me').expect(401);
      await refreshWithCookie(refreshCookie).expect(401);

      const duplicateRes = await publicPost('/auth/register', {
        ...TEST_USER,
        password: currentPassword,
      }).expect(409);

      expect(duplicateRes.body.message).toBe('Email already in use');
    });

    it('should cancel pending deletion from the email cancellation link', async () => {
      const token = mockMail.getDeletionCancelToken(TEST_USER.email);
      expect(token).toBeDefined();

      const res = await publicPost('/auth/account/deletion/cancel', {
        token,
      }).expect(200);

      expect(res.body.message).toBe('Account deletion has been cancelled');
      expect(mockMail.getDeletionCancelledCount(TEST_USER.email)).toBe(1);

      const retryRes = await publicPost('/auth/account/deletion/cancel', {
        token,
      }).expect(200);

      expect(retryRes.body.message).toBe('Account deletion has been cancelled');
      expect(mockMail.getDeletionCancelledCount(TEST_USER.email)).toBe(1);

      await loginAndStoreSession(currentPassword);
    });

    it('should cancel pending deletion when the user logs in again', async () => {
      const cancelledCount = mockMail.getDeletionCancelledCount(
        TEST_USER.email,
      );

      await request(app.getHttpServer())
        .delete('/api/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Origin', ORIGIN)
        .send({ password: currentPassword })
        .expect(200);

      await refreshWithCookie(refreshCookie).expect(401);
      await loginAndStoreSession(currentPassword);

      expect(mockMail.getDeletionCancelledCount(TEST_USER.email)).toBe(
        cancelledCount + 1,
      );
    });

    it('should permanently delete due accounts through the worker service', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Origin', ORIGIN)
        .send({ password: currentPassword })
        .expect(200);

      const dataSource = app.get(DataSource);
      await dataSource.query(
        `UPDATE users
         SET account_deletion_scheduled_for = NOW() - INTERVAL '1 second'
         WHERE email = $1`,
        [TEST_USER.email],
      );

      const deletedCount = await app
        .get(AuthService)
        .processDueAccountDeletions(new Date());

      expect(deletedCount).toBe(1);

      await publicPost('/auth/login', {
        email: TEST_USER.email,
        password: currentPassword,
      }).expect(401);

      const registerRes = await publicPost('/auth/register', {
        ...TEST_USER,
        password: currentPassword,
      }).expect(201);

      expect(registerRes.body.message).toBe(
        'Verify your email to activate your account',
      );
    });
  });
});
