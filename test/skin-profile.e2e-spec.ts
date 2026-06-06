import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp, MockMailService } from './test-setup';

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
  let app: INestApplication;
  let mockMail: MockMailService;
  let accessToken: string;

  function getAccessTokenFromResponse(res: request.Response): string {
    const body = res.body as { accessToken?: unknown };

    if (typeof body.accessToken !== 'string') {
      throw new Error('Auth response did not include a string accessToken');
    }

    return body.accessToken;
  }

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send(TEST_USER)
      .expect(201);
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

  async function loginAndStoreSession() {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({
        email: TEST_USER.email,
        password: TEST_USER.password,
      })
      .expect(200);

    accessToken = getAccessTokenFromResponse(res);
    expect(accessToken).toBeDefined();
  }

  describe('GET /skin-profile/options', () => {
    it('should return all options without auth', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/skin-profile/options')
        .expect(200);

      expect(res.body.skinTypes).toContain('oily');
      expect(res.body.skinTones).toContain('medium');
      expect(res.body.ethnicities).toContain('black');
      expect(res.body.concerns).toContain('acne');
      expect(res.body.fitzpatrickPhototypes).toContain('IV');
      expect(res.body.routinePaces).toContain('cautious');
    });
  });

  describe('Unverified email rejection', () => {
    it('should reject login for an unverified user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({
          email: TEST_USER.email,
          password: TEST_USER.password,
        })
        .expect(403);

      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(res.body.message).toBe('Email not verified');
    });
  });

  describe('After email verification', () => {
    beforeAll(async () => {
      const token = mockMail.getVerificationToken(TEST_USER.email);
      expect(token).toBeDefined();

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Origin', ORIGIN)
        .send({ token })
        .expect(200);

      await loginAndStoreSession();
    });

    it('should return 404 when no profile exists', async () => {
      await authGet('/skin-profile').expect(404);
    });

    it('should create a skin profile', async () => {
      const res = await authPost('/skin-profile', {
        skinType: 'oily',
        skinTone: 'medium',
        fitzpatrickPhototype: 'IV',
        dateOfBirth: '1992-04-15',
        sexAtBirth: 'female',
        ethnicity: 'black',
        currentConcerns: ['acne', 'dark_marks'],
        primaryGoal: 'acne',
        concernDetails: {
          per_concern: [
            { concern: 'acne', severity: 'moderate', priority: 1 },
            { concern: 'dark_marks', severity: 'mild', priority: 2 },
          ],
        },
        skinBehavior: {
          pih_tendency: 'often',
          melasma_tendency: 'never',
          keloid_tendency: 'never',
          sunscreen_habit: 'most_days',
          sunscreen_tolerance: 'fine',
        },
        routinePreferences: {
          pace: 'cautious',
          fragrance_free: true,
          non_comedogenic: true,
          sunscreen_filter: 'hybrid',
          sunscreen_finish: 'natural',
        },
        lifestyleContext: {
          water_hardness: 'unknown',
          water_sensitivity: 'none',
        },
        budgetTier: 'mid',
        allowSmartPicks: true,
        countryCode: 'SE',
        city: 'Stockholm',
        locationConsent: true,
      }).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.skinType).toBe('oily');
      expect(res.body.currentConcerns).toEqual(['acne', 'dark_marks']);
      expect(res.body.routinePreferences).toMatchObject({
        pace: 'cautious',
        fragrance_free: true,
      });
    });

    it('should reject duplicate profile', async () => {
      await authPost('/skin-profile', {
        skinType: 'dry',
        skinTone: 'medium',
        fitzpatrickPhototype: 'IV',
        dateOfBirth: '1992-04-15',
        sexAtBirth: 'female',
        ethnicity: 'black',
        currentConcerns: ['acne'],
        primaryGoal: 'acne',
        concernDetails: {
          per_concern: [{ concern: 'acne', severity: 'moderate', priority: 1 }],
        },
        skinBehavior: {
          pih_tendency: 'often',
          melasma_tendency: 'never',
          keloid_tendency: 'never',
          sunscreen_habit: 'most_days',
          sunscreen_tolerance: 'fine',
        },
        routinePreferences: {
          pace: 'cautious',
          fragrance_free: true,
          non_comedogenic: true,
          sunscreen_filter: 'hybrid',
          sunscreen_finish: 'natural',
        },
        lifestyleContext: {
          water_hardness: 'unknown',
          water_sensitivity: 'none',
        },
        budgetTier: 'mid',
        allowSmartPicks: true,
      }).expect(409);
    });

    it('should get the profile', async () => {
      const res = await authGet('/skin-profile').expect(200);

      expect(res.body.skinType).toBe('oily');
      expect(res.body.routinePreferences.pace).toBe('cautious');
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
      expect(res.body.routinePreferences.pace).toBe('cautious');
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
