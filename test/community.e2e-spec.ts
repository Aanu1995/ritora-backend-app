import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ulid } from 'ulid';
import {
  AdminAccountRole,
  AdminAccountStatus,
} from '../src/admin/entities/admin-account.entity';
import { CommunityModerationStatus } from '../src/community/community.types';
import {
  closeTestApp,
  createCompletedSkinProfile,
  createTestApp,
  createTestInventoryProduct,
  MockMailService,
} from './test-setup';

const ORIGIN = 'http://localhost:3000';
const TEST_USER = {
  email: 'community@example.com',
  password: 'TestPass1',
  firstName: 'Community',
  lastName: 'Test',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

async function createUserAccessToken(
  app: INestApplication,
  mockMail: MockMailService,
  user = TEST_USER,
) {
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send(user)
    .expect(201);

  const token = mockMail.getVerificationToken(user.email);
  expect(token).toBeDefined();

  await request(app.getHttpServer())
    .post('/api/v1/auth/verify-email')
    .set('Origin', ORIGIN)
    .send({ token })
    .expect(200);

  const loginResponse = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({
      email: user.email,
      password: user.password,
    })
    .expect(200);

  return loginResponse.body.accessToken as string;
}

async function createAdminAccessToken(app: INestApplication) {
  const dataSource = app.get(DataSource);
  const jwt = app.get(JwtService);
  const config = app.get(ConfigService);
  const adminId = ulid();
  const sessionId = ulid();

  await dataSource.query(
    `
      INSERT INTO "admin_accounts" (
        "id", "email", "canonical_email", "name", "role", "status",
        "password_hash", "created_at", "updated_at"
      )
      VALUES ($1, $2, $2, 'Community Admin', $3, $4, NULL, now(), now())
    `,
    [
      adminId,
      'community-admin@example.com',
      AdminAccountRole.Root,
      AdminAccountStatus.Active,
    ],
  );
  await dataSource.query(
    `
      INSERT INTO "admin_sessions" (
        "id", "admin_id", "refresh_token_hash", "expires_at",
        "revoked_at", "user_agent", "ip_address", "created_at", "last_used_at"
      )
      VALUES ($1, $2, 'fixture-refresh', now() + interval '1 day', NULL, 'jest', '127.0.0.1', now(), now())
    `,
    [sessionId, adminId],
  );

  return {
    adminId,
    token: jwt.sign(
      {
        email: 'community-admin@example.com',
        sid: sessionId,
        sub: adminId,
        typ: 'admin',
      },
      {
        audience: config.getOrThrow('JWT_AUDIENCE'),
        expiresIn: '1h',
        issuer: config.getOrThrow('JWT_ISSUER'),
      },
    ),
  };
}

describe('Community (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;
  let accessToken: string;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail);
    accessToken = await createUserAccessToken(app, mockMail);
    await createCompletedSkinProfile(app, accessToken);
    await createTestInventoryProduct(app, accessToken);
    await app.get(DataSource).query(
      `
        UPDATE "users"
        SET "created_at" = now() - interval '8 days',
            "updated_at" = now()
        WHERE "canonical_email" = $1
      `,
      [TEST_USER.email.toLowerCase()],
    );
    await request(app.getHttpServer())
      .post('/api/v1/community/guidelines/accept')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN)
      .expect(201);

    const eligibilityResponse = await request(app.getHttpServer())
      .get('/api/v1/community/eligibility')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(eligibilityResponse.body).toEqual(
      expect.objectContaining({
        eligible: true,
        emailVerified: true,
        hasAcceptedGuidelines: true,
        hasCompletedSkinProfile: true,
        hasShelfProduct: true,
      }),
    );

    const admin = await createAdminAccessToken(app);
    adminToken = admin.token;
    adminId = admin.adminId;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function authPost(path: string, body?: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN)
      .send(body ?? {});
  }

  function authPatch(path: string, body?: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN)
      .send(body ?? {});
  }

  function adminGet(path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  function adminPatch(path: string, body?: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Origin', ORIGIN)
      .send(body ?? {});
  }

  it('lets admins tune the minimum account age for community posting', async () => {
    const settingsResponse = await adminGet('/admin/community/settings').expect(
      200,
    );
    expect(settingsResponse.body).toEqual(
      expect.objectContaining({
        minimumAccountAgeDays: 3,
        updatedByAdminId: null,
        updatedByAdminLabel: null,
      }),
    );

    const ageTestUser = {
      ...TEST_USER,
      email: 'community-age-setting@example.com',
      firstName: 'Age',
    };
    const ageToken = await createUserAccessToken(app, mockMail, ageTestUser);
    await createCompletedSkinProfile(app, ageToken);
    await createTestInventoryProduct(app, ageToken);
    await app.get(DataSource).query(
      `
        UPDATE "users"
        SET "created_at" = now() - interval '2 days',
            "updated_at" = now()
        WHERE "canonical_email" = $1
      `,
      [ageTestUser.email.toLowerCase()],
    );
    await request(app.getHttpServer())
      .post('/api/v1/community/guidelines/accept')
      .set('Authorization', `Bearer ${ageToken}`)
      .set('Origin', ORIGIN)
      .expect(201);

    const beforeUpdate = await request(app.getHttpServer())
      .get('/api/v1/community/eligibility')
      .set('Authorization', `Bearer ${ageToken}`)
      .expect(200);
    expect(beforeUpdate.body.minimumAccountAgeDays).toBe(3);
    expect(beforeUpdate.body.eligible).toBe(false);

    const updateResponse = await adminPatch('/admin/community/settings', {
      minimumAccountAgeDays: 2,
      reason: 'Tune launch posting trust gate for e2e.',
    }).expect(200);
    expect(updateResponse.body).toEqual(
      expect.objectContaining({
        minimumAccountAgeDays: 2,
        updatedByAdminId: adminId,
        updatedByAdminLabel: 'Community Admin (community-admin@example.com)',
      }),
    );

    const afterUpdate = await request(app.getHttpServer())
      .get('/api/v1/community/eligibility')
      .set('Authorization', `Bearer ${ageToken}`)
      .expect(200);
    expect(afterUpdate.body.minimumAccountAgeDays).toBe(2);
    expect(afterUpdate.body.eligible).toBe(true);

    const auditRows = await app.get(DataSource).query(
      `
        SELECT "action", "metadata"
        FROM "admin_audit_logs"
        WHERE "action" = 'community_settings_updated'
        ORDER BY "created_at" DESC
        LIMIT 1
      `,
    );
    expect(auditRows[0]).toEqual(
      expect.objectContaining({
        action: 'community_settings_updated',
        metadata: expect.objectContaining({
          minimumAccountAgeDays: 2,
          previousMinimumAccountAgeDays: 3,
        }),
      }),
    );

    await adminPatch('/admin/community/settings', {
      minimumAccountAgeDays: 3,
      reason: 'Restore default community posting age after e2e.',
    }).expect(200);
  });

  it('blocks public posting until launch eligibility requirements are met', async () => {
    const youngUser = {
      ...TEST_USER,
      email: 'community-young@example.com',
      firstName: 'Young',
    };
    const youngToken = await createUserAccessToken(app, mockMail, youngUser);
    await createCompletedSkinProfile(app, youngToken);
    await createTestInventoryProduct(app, youngToken);

    const initialEligibility = await request(app.getHttpServer())
      .get('/api/v1/community/eligibility')
      .set('Authorization', `Bearer ${youngToken}`)
      .expect(200);
    expect(initialEligibility.body.eligible).toBe(false);
    expect(
      initialEligibility.body.reasons.map(
        (reason: { code: string }) => reason.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        'account_too_new',
        'community_guidelines_required',
      ]),
    );

    await request(app.getHttpServer())
      .post('/api/v1/community/reviews')
      .set('Authorization', `Bearer ${youngToken}`)
      .set('Origin', ORIGIN)
      .send({
        productBrand: 'Ritora',
        productName: 'Barrier Cream',
        productCategory: 'moisturizer',
        disclosureType: 'ordinary',
        usageDuration: '4-weeks',
        frequency: 'daily',
        routineSlot: 'pm',
        skinResponse: 'improved',
        overallRating: 5,
        effectivenessRating: 4,
        irritationRating: 1,
        outcomes: ['barrier'],
        repurchase: 'yes',
        routineContext: [{ category: 'cleanser', productName: 'Milky Cleanser' }],
        body: 'This felt comfortable in my routine.',
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/community/guidelines/accept')
      .set('Authorization', `Bearer ${youngToken}`)
      .set('Origin', ORIGIN)
      .expect(201);

    const postGuidelinesEligibility = await request(app.getHttpServer())
      .get('/api/v1/community/eligibility')
      .set('Authorization', `Bearer ${youngToken}`)
      .expect(200);
    expect(postGuidelinesEligibility.body.hasAcceptedGuidelines).toBe(true);
    expect(postGuidelinesEligibility.body.eligible).toBe(false);
    expect(
      postGuidelinesEligibility.body.reasons.map(
        (reason: { code: string }) => reason.code,
      ),
    ).toEqual(expect.arrayContaining(['account_too_new']));
  });

  it('covers review, routine moderation, report auto-hide, edit/resubmit, assignment, notifications, and adaptation', async () => {
    const reviewResponse = await authPost('/community/reviews', {
      productBrand: 'Ritora',
      productName: 'Barrier Cream',
      productCategory: 'moisturizer',
      disclosureType: 'ordinary',
      usageDuration: '4-weeks',
      frequency: 'daily',
      routineSlot: 'pm',
      skinResponse: 'improved',
      overallRating: 5,
      effectivenessRating: 4,
      irritationRating: 1,
      outcomes: ['barrier'],
      repurchase: 'yes',
      routineContext: [{ category: 'cleanser', productName: 'Milky Cleanser' }],
      body: 'This felt comfortable in my routine.',
    }).expect(201);
    expect(reviewResponse.body.moderationStatus).toBe(
      CommunityModerationStatus.Published,
    );

    const routineResponse = await authPost('/community/routines', {
      title: 'Too aggressive PM routine',
      summary: 'This cured my acne with nightly retinol and glycolic acid.',
      disclosureType: 'ordinary',
      concernTags: ['acne'],
      goalTags: ['texture'],
      goalResult: 'mixed',
      timeframe: '4-weeks',
      avoidTags: ['over-exfoliation'],
      habitTags: ['consistent-sleep'],
      didNotWorkTags: ['nightly-acids'],
      warningTags: ['go-slow-if-sensitive'],
      steps: [
        {
          slot: 'pm',
          category: 'treatment',
          productName: 'Retinol treatment',
          frequency: 'nightly',
          notes: 'Retinol treatment',
        },
        {
          slot: 'pm',
          category: 'exfoliant',
          productName: 'Glycolic acid toner',
          frequency: 'nightly',
          notes: 'Glycolic acid toner',
        },
      ],
    }).expect(201);
    const routineId = routineResponse.body.id as string;
    expect(routineResponse.body.moderationStatus).toBe(
      CommunityModerationStatus.PendingReview,
    );

    const moderationResponse = await adminGet(
      '/admin/community/moderation?status=pending_review&contentType=routine&severity=high&search=aggressive',
    ).expect(200);
    expect(moderationResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: routineId, assignedAdminId: null }),
      ]),
    );

    await adminPatch(`/admin/community/content/${routineId}/assignment`, {
      assignedAdminId: adminId,
      reason: 'Claiming for e2e moderation.',
    }).expect(200);

    const assignedResponse = await adminGet(
      `/admin/community/moderation?assignedAdminId=${adminId}`,
    ).expect(200);
    expect(assignedResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: routineId, assignedAdminId: adminId }),
      ]),
    );

    await adminPatch(`/admin/community/content/${routineId}/moderation`, {
      status: 'needs_edit',
      reason: 'Remove medical claim and unsafe active layering.',
    }).expect(200);

    await authPatch(`/community/routines/${routineId}`, {
      title: 'Gentle PM routine',
      summary: 'A cautious PM routine focused on consistency.',
    }).expect(200);

    await adminPatch(`/admin/community/content/${routineId}/moderation`, {
      status: 'published',
      reason: 'Edited content is safe to publish.',
    }).expect(200);

    const adaptResponse = await authPost(
      `/community/routines/${routineId}/adapt-to-shelf`,
    ).expect(201);
    expect(adaptResponse.body.summary).toEqual(
      expect.objectContaining({
        kept: expect.any(Number),
        gaps: expect.any(Number),
      }),
    );

    const secondRoutineResponse = await authPost('/community/routines', {
      title: 'Simple AM routine',
      summary: 'A gentle morning routine focused on barrier support.',
      disclosureType: 'ordinary',
      concernTags: ['barrier'],
      goalTags: ['maintenance'],
      goalResult: 'mostly_improved',
      timeframe: '8-weeks',
      avoidTags: ['over-exfoliation'],
      habitTags: ['consistent-sleep'],
      didNotWorkTags: ['too-many-actives'],
      warningTags: ['patch-test-first'],
      steps: [
        {
          slot: 'am',
          category: 'cleanser',
          productName: 'Gentle Cleanser',
          frequency: 'daily',
          notes: 'Gentle cleanse',
        },
      ],
    }).expect(201);
    const secondRoutineId = secondRoutineResponse.body.id as string;

    const secondAdaptResponse = await authPost(
      `/community/routines/${secondRoutineId}/adapt-to-shelf`,
    ).expect(201);
    await authPost(`/community/routines/${routineId}/save-adaptation`, {
      adaptationId: secondAdaptResponse.body.id,
    }).expect(404);
    await authPost(`/community/routines/${secondRoutineId}/save-adaptation`, {
      adaptationId: secondAdaptResponse.body.id,
    }).expect(201);

    const reporterToken = await createUserAccessToken(app, mockMail, {
      ...TEST_USER,
      email: 'community-reporter@example.com',
      firstName: 'Reporter',
    });

    await request(app.getHttpServer())
      .post(`/api/v1/community/routines/${routineId}/report`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .set('Origin', ORIGIN)
      .send({
        reason: 'unsafe_advice',
        note: 'This still looks unsafe.',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/community/routines/${routineId}/report`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .set('Origin', ORIGIN)
      .send({
        reason: 'unsafe_advice',
        note: 'Duplicate click should not create another report.',
      })
      .expect(201);
    const duplicateReportRows = await app.get(DataSource).query(
      `
        SELECT COUNT(*)::int AS "count"
        FROM "community_reports"
        WHERE "content_type" = 'routine'
          AND "content_id" = $1
          AND "reason" = 'unsafe_advice'
      `,
      [routineId],
    );
    expect(duplicateReportRows[0].count).toBe(1);

    const reportedResponse = await adminGet(
      '/admin/community/moderation?reason=unsafe_advice&status=pending_review',
    ).expect(200);
    expect(reportedResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: routineId, status: 'pending_review' }),
      ]),
    );

    const notificationRows = await app.get(DataSource).query(
      `
        SELECT "body_key"
        FROM "in_app_notifications"
        WHERE "kind" = 'community_moderation'
        ORDER BY "created_at" DESC
      `,
    );
    expect(
      notificationRows.map((row: { body_key: string }) => row.body_key),
    ).toEqual(
      expect.arrayContaining([
        'community.notifications.moderation.needs_edit',
        'community.notifications.moderation.published',
      ]),
    );
  });
});
