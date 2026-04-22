import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, MockMailService, truncateTables } from './test-setup';

const ORIGIN = 'http://localhost:3000';

const TEST_USER = {
  email: 'schedule@example.com',
  password: 'TestPass1',
  firstName: 'Schedule',
  lastName: 'Test',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

function resolveWeekdayForTimezone(timezone: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date());

  const map: Record<string, string> = {
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
    Sun: 'sun',
  };

  return map[weekday];
}

function findTimezonePairWithDifferentWeekdays(): {
  savedTimeZone: string;
  requestTimeZone: string;
} {
  const candidates = [
    'Pacific/Kiritimati',
    'Europe/Stockholm',
    'UTC',
    'America/New_York',
    'Pacific/Honolulu',
  ];

  for (const savedTimeZone of candidates) {
    for (const requestTimeZone of candidates) {
      if (
        savedTimeZone !== requestTimeZone &&
        resolveWeekdayForTimezone(savedTimeZone) !==
          resolveWeekdayForTimezone(requestTimeZone)
      ) {
        return { savedTimeZone, requestTimeZone };
      }
    }
  }

  throw new Error('Expected at least one timezone pair with distinct weekdays');
}

describe('Schedule (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;
  let accessToken: string;

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send(TEST_USER)
      .expect(201);

    const token = mockMail.getVerificationToken(TEST_USER.email);
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
        email: TEST_USER.email,
        password: TEST_USER.password,
      })
      .expect(200);

    accessToken = loginResponse.body.accessToken;
    expect(accessToken).toBeDefined();
  });

  afterAll(async () => {
    if (!app) {
      return;
    }

    await truncateTables(app);
    await app.close();
  });

  function authGet(path: string, timeZone?: string) {
    const req = request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`);

    return timeZone ? req.set('X-Timezone', timeZone) : req;
  }

  function authPost(
    path: string,
    body?: Record<string, unknown>,
    timeZone?: string,
  ) {
    const req = request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN);

    if (timeZone) {
      req.set('X-Timezone', timeZone);
    }

    return body ? req.send(body) : req;
  }

  function authPatch(
    path: string,
    body: Record<string, unknown>,
    timeZone?: string,
  ) {
    const req = request(app.getHttpServer())
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN);

    if (timeZone) {
      req.set('X-Timezone', timeZone);
    }

    return req.send(body);
  }

  function authDelete(path: string) {
    return request(app.getHttpServer())
      .delete(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN);
  }

  it('returns an empty schedule before setup', async () => {
    const response = await authGet('/schedule').expect(200);

    expect(response.body).toEqual({ slots: [], timeZone: 'UTC' });
  });

  it('captures timezone once on the first authenticated request and does not silently overwrite it later', async () => {
    const authMe = await authGet('/auth/me', 'Europe/Stockholm').expect(200);
    expect(authMe.body.timeZone).toBe('Europe/Stockholm');

    const usersMe = await authGet('/users/me', 'America/New_York').expect(200);
    expect(usersMe.body.timeZone).toBe('Europe/Stockholm');
  });

  it('creates a subset batch and skips duplicates that already exist', async () => {
    const firstBatch = await authPost('/schedule/slots/batch', {
      daysOfWeek: ['mon', 'wed', 'wed'],
      slotTime: '08:00',
      mode: 'ai',
    }).expect(201);

    expect(
      firstBatch.body.slots.map(
        (slot: { dayOfWeek: string }) => slot.dayOfWeek,
      ),
    ).toEqual(['mon', 'wed']);
    expect(firstBatch.body.timeZone).toBe('Europe/Stockholm');

    const secondBatch = await authPost('/schedule/slots/batch', {
      daysOfWeek: ['wed', 'fri'],
      slotTime: '08:00',
      mode: 'ai',
    }).expect(201);

    expect(
      secondBatch.body.slots.map(
        (slot: { dayOfWeek: string }) => slot.dayOfWeek,
      ),
    ).toEqual(['mon', 'wed', 'fri']);
  });

  it('supports create, update, and delete for a single slot', async () => {
    const created = await authPost('/schedule/slots', {
      dayOfWeek: 'sun',
      slotTime: '21:00',
      mode: 'manual',
    }).expect(201);

    expect(created.body.mode).toBe('manual');

    const updated = await authPatch(`/schedule/slots/${created.body.id}`, {
      mode: 'ai',
      slotNotes: 'Evening routine',
    }).expect(200);

    expect(updated.body.mode).toBe('ai');
    expect(updated.body.slotNotes).toBe('Evening routine');

    await authDelete(`/schedule/slots/${created.body.id}`).expect(204);

    const schedule = await authGet('/schedule').expect(200);
    expect(
      schedule.body.slots.find(
        (slot: { id: string }) => slot.id === created.body.id,
      ),
    ).toBeUndefined();
  });

  it('updates the saved timezone explicitly and keeps today anchored to it across device changes', async () => {
    const { savedTimeZone, requestTimeZone } =
      findTimezonePairWithDifferentWeekdays();
    const savedDay = resolveWeekdayForTimezone(savedTimeZone);

    const updatedUser = await authPatch('/users/me/time-zone', {
      timeZone: savedTimeZone,
    }).expect(200);

    expect(updatedUser.body.timeZone).toBe(savedTimeZone);

    await authPost(
      '/schedule/slots',
      {
        dayOfWeek: savedDay,
        slotTime: '06:30',
        mode: 'ai',
      },
      savedTimeZone,
    ).expect(201);

    const response = await authGet('/schedule/today', requestTimeZone).expect(
      200,
    );

    expect(response.body.dayOfWeek).toBe(savedDay);
    expect(response.body.timeZone).toBe(savedTimeZone);
    expect(
      response.body.slots.some(
        (slot: { dayOfWeek: string; slotTime: string }) => {
          return slot.dayOfWeek === savedDay && slot.slotTime === '06:30';
        },
      ),
    ).toBe(true);
  });

  it('rejects invalid explicit timezone updates', async () => {
    const response = await authPatch('/users/me/time-zone', {
      timeZone: '+01:00',
    }).expect(400);

    expect(response.body.message).toBeDefined();
  });

  it('returns coded Swedish conflict errors for move collisions', async () => {
    const first = await authPost('/schedule/slots', {
      dayOfWeek: 'tue',
      slotTime: '07:00',
      mode: 'manual',
    }).expect(201);

    await authPost('/schedule/slots', {
      dayOfWeek: 'wed',
      slotTime: '07:00',
      mode: 'manual',
    }).expect(201);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/schedule/slots/${first.body.id}/move`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN)
      .set('Accept-Language', 'sv')
      .send({
        toDay: 'wed',
        toTime: '07:00',
      })
      .expect(409);

    expect(response.body.code).toBe('SCHEDULE_MOVE_CONFLICT');
    expect(response.body.message).not.toBe(
      'A slot already exists at the destination day and time',
    );
  });
});
