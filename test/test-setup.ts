import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/mail/mail.service';

type TestAppProviderOverride = {
  provider: unknown;
  useValue: unknown;
};

export class MockMailService {
  verificationTokens = new Map<string, string>();
  resetTokens = new Map<string, string>();

  async sendVerificationEmail(
    email: string,
    token: string,
    _firstName: string,
  ): Promise<void> {
    this.verificationTokens.set(email, token);
  }

  async sendPasswordResetEmail(
    email: string,
    token: string,
    _firstName: string,
  ): Promise<void> {
    this.resetTokens.set(email, token);
  }

  getVerificationToken(email: string): string | undefined {
    return this.verificationTokens.get(email);
  }

  getResetToken(email: string): string | undefined {
    return this.resetTokens.get(email);
  }

  clear(): void {
    this.verificationTokens.clear();
    this.resetTokens.clear();
  }
}

export async function createTestApp(
  mockMailService: MockMailService,
  providerOverrides: TestAppProviderOverride[] = [],
): Promise<INestApplication> {
  let moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mockMailService);

  for (const override of providerOverrides) {
    moduleBuilder = moduleBuilder
      .overrideProvider(override.provider as never)
      .useValue(override.useValue);
  }

  const moduleFixture = await moduleBuilder.compile();

  const app = moduleFixture.createNestApplication();
  const configService = app.get(ConfigService);
  configureApp(app, configService);
  await app.init();

  const dataSource = app.get(DataSource);
  await dataSource.runMigrations();

  return app;
}

export async function truncateTables(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const entities = dataSource.entityMetadatas;

  const tableNames = entities.map((e) => `"${e.tableName}"`).join(', ');

  if (tableNames.length > 0) {
    await dataSource.query(`TRUNCATE TABLE ${tableNames} CASCADE`);
  }
}
