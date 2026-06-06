import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp, MockMailService } from './test-setup';

describe('Health endpoint (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp(new MockMailService());
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(
        (response: {
          body: {
            checks: {
              api: { status: string };
              database: { status: string };
            };
            status: string;
            timestamp: string;
          };
        }) => {
          expect(response.body.status).toBe('ok');
          expect(typeof response.body.timestamp).toBe('string');
          expect(response.body.checks.api.status).toBe('ok');
          expect(response.body.checks.database.status).toBe('ok');
        },
      );
  });
});
