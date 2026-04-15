import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, MockMailService, truncateTables } from './test-setup';

const ORIGIN = 'http://localhost:3000';

const TEST_USER = {
  email: 'skinprofile@example.com',
  password: 'TestPass1',
  firstName: 'Skin',
  lastName: 'Test',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

describe('Skin Profile (e2e)', () => {
  let app: INestApplication<App>;
  let mockMail: MockMailService;
  let accessToken: string;

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail);

    // Register a user
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send(TEST_USER)
      .expect(201);

    accessToken = registerRes.body.accessToken;
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
      .set('Authorization', `Bearer ${accessToken}`);
    return body ? req.send(body) : req;
  }

  function authPatch(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  }

  function authDelete(path: string) {
    return request(app.getHttpServer())
      .delete(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  // ─── Options (Public) ──────────────────────────

  describe('GET /skin-profile/options', () => {
    it('should return all options without auth', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/skin-profile/options')
        .expect(200);

      expect(res.body.skinTypes).toContain('oily');
      expect(res.body.skinTones).toContain('medium');
      expect(res.body.ageRanges).toContain('25_34');
      expect(res.body.ethnicities).toContain('black');
      expect(res.body.concerns).toContain('acne');
      expect(res.body.goals).toContain('clear_acne');
      expect(res.body.complexities).toContain('minimal');
    });
  });

  // ─── Unverified User Rejection ──────────────────

  describe('Unverified email rejection', () => {
    it('should reject skin profile creation for unverified user', async () => {
      await authPost('/skin-profile', {
        skinType: 'oily',
      }).expect(403);
    });
  });

  // ─── Verify email to proceed ────────────────────

  describe('After email verification', () => {
    beforeAll(async () => {
      const token = mockMail.getVerificationToken(TEST_USER.email);
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Origin', ORIGIN)
        .send({ token })
        .expect(200);
    });

    // ─── CRUD ─────────────────────────────────────

    it('should return 404 when no profile exists', async () => {
      await authGet('/skin-profile').expect(404);
    });

    it('should create a skin profile', async () => {
      const res = await authPost('/skin-profile', {
        skinType: 'oily',
        skinTone: 'medium',
        ageRange: '25_34',
        currentConcerns: ['acne', 'dark_marks'],
        knownSensitivities: ['retinol', 'fragrance'],
        skinGoals: ['clear_acne'],
        countryCode: 'SE',
        city: 'Stockholm',
        locationConsent: true,
        routineComplexity: 'moderate',
      }).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.skinType).toBe('oily');
      expect(res.body.currentConcerns).toEqual(['acne', 'dark_marks']);
      expect(res.body.knownSensitivities).toEqual(['retinol', 'fragrance']);
    });

    it('should reject duplicate profile', async () => {
      await authPost('/skin-profile', {
        skinType: 'dry',
      }).expect(409);
    });

    it('should get the profile', async () => {
      const res = await authGet('/skin-profile').expect(200);

      expect(res.body.skinType).toBe('oily');
      expect(res.body.routineComplexity).toBe('moderate');
    });

    it('should partially update the profile', async () => {
      const res = await authPatch('/skin-profile', {
        skinType: 'combination',
        city: 'Stockholm',
        countryCode: 'SE',
      }).expect(200);

      expect(res.body.skinType).toBe('combination');
      expect(res.body.city).toBe('Stockholm');
      expect(res.body.countryCode).toBe('SE');
      expect(res.body.routineComplexity).toBe('moderate');
    });

    it('should include location consent in data export', async () => {
      const res = await authPost('/auth/export', {
        password: TEST_USER.password,
      }).expect(200);

      expect(res.body.skinProfile).toMatchObject({
        countryCode: 'SE',
        city: 'Stockholm',
      });
      expect(res.body.consents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            consentType: 'location_processing',
            granted: true,
          }),
        ]),
      );
    });

    it('should reject invalid skin type', async () => {
      await authPatch('/skin-profile', {
        skinType: 'invalid_type',
      }).expect(400);
    });

    it('should delete the profile', async () => {
      const res = await authDelete('/skin-profile').expect(200);
      expect(res.body.message).toBe('Skin profile deleted');
    });

    it('should return 404 after deletion', async () => {
      await authGet('/skin-profile').expect(404);
    });
  });
});
