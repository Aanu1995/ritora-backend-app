import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CataloguePhotoStorageService } from '../src/catalogue/catalogue-photo-storage.service';
import { assertDestructiveTestDatabaseResetAllowed } from '../src/common/utils/destructive-database-guard';
import { MailService } from '../src/mail/mail.service';
import {
  ApplicationMethod,
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatus,
} from '../src/shelf/shelf.types';

type TestAppProviderOverride = {
  provider: unknown;
  useValue: unknown;
};

export class MockMailService {
  verificationTokens = new Map<string, string>();
  resetTokens = new Map<string, string>();
  adminInvitationTokens = new Map<string, string>();
  adminResetTokens = new Map<string, string>();
  deletionConfirmTokens = new Map<string, string>();
  deletionCancelTokens = new Map<string, string>();
  deletionCancelledCounts = new Map<string, number>();

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

  async sendAdminInvitationEmail(
    email: string,
    token: string,
    _invitedByName: string,
  ): Promise<void> {
    this.adminInvitationTokens.set(email, token);
  }

  async sendAdminPasswordResetEmail(
    email: string,
    token: string,
    _name: string,
  ): Promise<void> {
    this.adminResetTokens.set(email, token);
  }

  buildAdminPasswordResetUrl(token: string): string {
    return `http://localhost:3002/reset-password/${encodeURIComponent(token)}`;
  }

  async sendAccountDeletionConfirmationEmail(
    email: string,
    token: string,
    _firstName: string,
  ): Promise<void> {
    this.deletionConfirmTokens.set(email, token);
  }

  async sendAccountDeletionScheduledEmail(
    email: string,
    token: string,
    _firstName: string,
  ): Promise<void> {
    this.deletionCancelTokens.set(email, token);
  }

  async sendAccountDeletionCancelledEmail(
    email: string,
    _firstName: string,
  ): Promise<void> {
    const currentCount = this.deletionCancelledCounts.get(email) ?? 0;
    this.deletionCancelledCounts.set(email, currentCount + 1);
  }

  getVerificationToken(email: string): string | undefined {
    return this.verificationTokens.get(email);
  }

  getResetToken(email: string): string | undefined {
    return this.resetTokens.get(email);
  }

  getAdminInvitationToken(email: string): string | undefined {
    return this.adminInvitationTokens.get(email);
  }

  getAdminResetToken(email: string): string | undefined {
    return this.adminResetTokens.get(email);
  }

  getDeletionConfirmToken(email: string): string | undefined {
    return this.deletionConfirmTokens.get(email);
  }

  getDeletionCancelToken(email: string): string | undefined {
    return this.deletionCancelTokens.get(email);
  }

  getDeletionCancelledCount(email: string): number {
    return this.deletionCancelledCounts.get(email) ?? 0;
  }

  clear(): void {
    this.verificationTokens.clear();
    this.resetTokens.clear();
    this.adminInvitationTokens.clear();
    this.adminResetTokens.clear();
    this.deletionConfirmTokens.clear();
    this.deletionCancelTokens.clear();
    this.deletionCancelledCounts.clear();
  }
}

export class MockCataloguePhotoStorageService {
  startHeroImageUpload(): { url: Promise<null>; cleanup: () => Promise<void> } {
    return {
      url: Promise.resolve(null),
      cleanup: async () => {},
    };
  }

  async saveHeroImage(): Promise<null> {
    return null;
  }

  toPersistentImageUrls(imageUrls: string[]): string[] {
    return imageUrls;
  }

  resolvePublicImageUrls(imageUrls: string[]): string[] {
    return imageUrls;
  }

  async deleteManagedImageUrls(): Promise<void> {}

  async deleteManagedImagesForOwner(): Promise<void> {}
}

export async function createTestApp(
  mockMailService: MockMailService,
  providerOverrides: TestAppProviderOverride[] = [],
): Promise<INestApplication> {
  let moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mockMailService)
    .overrideProvider(CataloguePhotoStorageService)
    .useValue(new MockCataloguePhotoStorageService());

  for (const override of providerOverrides) {
    moduleBuilder = moduleBuilder
      .overrideProvider(override.provider as never)
      .useValue(override.useValue);
  }

  const moduleFixture = await moduleBuilder.compile();
  const app = moduleFixture.createNestApplication();

  try {
    const configService = app.get(ConfigService);
    configureApp(app, configService);

    // E2E tests run against a real Postgres database. Apply pending migrations
    // before Nest lifecycle hooks run so boot-time catalogue refreshes see the
    // same schema CI and local developers expect.
    const dataSource = app.get(DataSource);
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    await dataSource.runMigrations({ transaction: 'each' });

    await app.init();

    await truncateTables(app);

    return app;
  } catch (error) {
    await app.close().catch(() => {
      // Surface the original setup failure; close errors here are secondary.
    });
    throw error;
  }
}

const TRUNCATE_TABLES_LOCK_KEY = 'ritora:e2e:truncate-tables';
const TRUNCATE_LOCK_TIMEOUT_MS = 5000;
const TRUNCATE_MAX_ATTEMPTS = 3;
const TRUNCATE_RETRY_DELAY_MS = 100;
const TRUNCATE_RETRYABLE_ERROR_CODES = new Set([
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
]);

type PostgresError = {
  code?: string;
};

function isPostgresError(error: unknown): error is PostgresError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function getPostgresErrorCode(error: unknown): string | undefined {
  return isPostgresError(error) ? error.code : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function truncateTables(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  assertDestructiveTestDatabaseResetAllowed({
    databaseName: dataSource.options.database,
    operation: 'E2E truncateTables',
  });
  const entities = dataSource.entityMetadatas;

  const tableNames = entities
    .map((e) => `"${e.tableName}"`)
    .sort()
    .join(', ');

  if (tableNames.length === 0) {
    return;
  }

  for (let attempt = 1; attempt <= TRUNCATE_MAX_ATTEMPTS; attempt += 1) {
    const queryRunner = dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      await queryRunner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        TRUNCATE_TABLES_LOCK_KEY,
      ]);
      await queryRunner.query(
        `SET LOCAL lock_timeout = '${TRUNCATE_LOCK_TIMEOUT_MS}ms'`,
      );
      await queryRunner.query(
        `TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`,
      );
      await queryRunner.commitTransaction();
      return;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // Keep the original truncate error so the failing lock/query is visible.
        }
      }

      const errorCode = getPostgresErrorCode(error);
      const shouldRetry =
        attempt < TRUNCATE_MAX_ATTEMPTS &&
        errorCode !== undefined &&
        TRUNCATE_RETRYABLE_ERROR_CODES.has(errorCode);

      if (!shouldRetry) {
        throw error;
      }

      await delay(TRUNCATE_RETRY_DELAY_MS * attempt);
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function closeTestApp(
  app: INestApplication | null | undefined,
): Promise<void> {
  if (!app) {
    return;
  }

  let cleanupError: unknown;
  try {
    await truncateTables(app);
  } catch (error) {
    cleanupError = error;
  }

  let closeError: unknown;
  try {
    await app.close();
  } catch (error) {
    closeError = error;
  }

  if (cleanupError && closeError) {
    throw new Error(
      `E2E cleanup and app close both failed. Cleanup: ${unknownErrorMessage(
        cleanupError,
      )}. Close: ${unknownErrorMessage(closeError)}.`,
    );
  }

  if (cleanupError) {
    throw toError(cleanupError);
  }

  if (closeError) {
    throw toError(closeError);
  }
}

export async function createCompletedSkinProfile(
  app: INestApplication,
  accessToken: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/v1/skin-profile')
    .set('Authorization', `Bearer ${accessToken}`)
    .set('Origin', 'http://localhost:3000')
    .send({
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
    })
    .expect(201);
}

export async function createTestInventoryProduct(
  app: INestApplication,
  accessToken: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/inventory/products')
    .set('Authorization', `Bearer ${accessToken}`)
    .set('Origin', 'http://localhost:3000')
    .send({
      identity: {
        brand: 'Ritora',
        name: 'Schedule Fixture Moisturizer',
        category: ProductCategory.Moisturizer,
        barcode: null,
        imageUrls: ['https://cdn.example.com/product-images/fixture.webp'],
        sizeMl: 50,
        description: 'Fixture product used to unlock schedule creation.',
        benefits: ['barrier support'],
        suitedFor: ['all'],
        inciIngredients: ['Water', 'Glycerin'],
        inciLastConfirmedAt: new Date().toISOString(),
      },
      guidance: {
        applicationMethod: ApplicationMethod.Fingertips,
        quantity: Quantity.PeaSize,
        steps: ['Apply to clean skin.'],
        cautions: [],
        waitMinutes: 1,
      },
      manufacturer: {
        brand: 'Ritora',
        parentCompany: null,
        countryOfOrigin: 'SE',
        countryOfManufacture: 'SE',
        supportEmail: 'support@example.com',
        productUrl: 'https://example.com/products/schedule-fixture',
        websiteUrl: 'https://example.com',
      },
      userFields: {
        openedAt: new Date().toISOString(),
        expiresAt: null,
        periodAfterOpeningMonths: 12,
        pricePaid: 20,
        pricePaidCurrency: 'USD',
        purchasedFrom: 'Test',
        personalNotes: null,
        preferredTimeOfDay: PreferredTimeOfDay.Evening,
      },
      status: ShelfStatus.Active,
      provenance: DataProvenance.PhotoLookup,
    })
    .expect(201);

  const body = response.body as { id?: unknown };
  if (typeof body.id !== 'string') {
    throw new Error('Fixture inventory product response did not include id');
  }

  return body.id;
}
