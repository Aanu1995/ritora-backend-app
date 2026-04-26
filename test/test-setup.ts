import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { IngredientCatalogService } from '../src/ingredients/ingredient-catalog.service';
import { IngredientsSeeder } from '../src/ingredients/seed/ingredients-seeder';
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

  // E2E tests run against a real Postgres database. Apply pending migrations
  // before Nest lifecycle hooks run so boot-time catalogue refreshes see the
  // same schema CI and local developers expect.
  const dataSource = app.get(DataSource);
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  await dataSource.runMigrations();

  await app.init();

  //
  // Seed + refresh the ingredient catalogue now that the app is up. These
  // mirror what `IngredientsModule.onApplicationBootstrap` does at
  // production startup — idempotent upsert + in-memory cache reload.
  const seeder = app.get(IngredientsSeeder);
  await seeder.run();
  const catalog = app.get(IngredientCatalogService);
  await catalog.refresh();

  return app;
}

const INGREDIENT_REFERENCE_TABLES = new Set([
  'ingredient_entries',
  'ingredient_aliases',
  'ingredient_category_patterns',
  'ingredient_conflict_rules',
]);

export async function truncateTables(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const entities = dataSource.entityMetadatas;

  // Ingredient catalogue rows are reference data — seeded once per test
  // boot via IngredientsSeeder. Truncating them between tests would force
  // a re-seed every time and doesn't match user-data semantics.
  const tableNames = entities
    .filter((e) => !INGREDIENT_REFERENCE_TABLES.has(e.tableName))
    .map((e) => `"${e.tableName}"`)
    .join(', ');

  if (tableNames.length > 0) {
    await dataSource.query(`TRUNCATE TABLE ${tableNames} CASCADE`);
  }
}
