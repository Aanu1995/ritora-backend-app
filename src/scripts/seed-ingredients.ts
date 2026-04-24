/**
 * Standalone ingredient seeder entry point.
 *
 * Usage: `npm run ingredients:seed` (which wraps `nest build` + `node`).
 *
 * Opens the shared TypeORM DataSource, instantiates IngredientsSeeder,
 * runs the upsert transaction, and exits. No Nest application context.
 *
 * Runs after `npm run migration:run` as part of a deploy or local-dev
 * reseed (e.g. after editing ingredients-seed.json).
 */
import 'dotenv/config';
import dataSource from '../database/data-source';
import { IngredientsSeeder } from '../ingredients/seed/ingredients-seeder';

async function main(): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const seeder = new IngredientsSeeder(dataSource);
    await seeder.run();
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(
    `Seeder failed: ${error instanceof Error ? (error.stack ?? error.message) : 'unknown error'}`,
  );
  process.exit(1);
});
