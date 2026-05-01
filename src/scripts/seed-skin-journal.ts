/**
 * Standalone Skin Journal + Notifications demo seeder.
 *
 * Usage: `npm run skin-journal:seed` after migrations have run.
 *
 * Creates or reuses a local demo user, resets that user's Skin Journal and
 * notification demo data, writes local WebP journal photos, and exits. No Nest
 * application context is needed.
 */
import 'dotenv/config';
import dataSource from '../database/data-source';
import {
  demoSeedCredentials,
  SkinJournalDemoSeeder,
} from '../skin-journal/seed/skin-journal-demo-seeder';

async function main(): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const seeder = new SkinJournalDemoSeeder(dataSource);
    const result = await seeder.run();
    const credentials = demoSeedCredentials();
    console.log(
      [
        'Skin Journal demo seed complete.',
        `User: ${result.user.email}`,
        `Password: ${credentials.password}`,
        `Entries: ${result.entryCount}`,
        `Notifications: ${result.notificationCount}`,
      ].join('\n'),
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(
    `Skin Journal seeder failed: ${error instanceof Error ? (error.stack ?? error.message) : 'unknown error'}`,
  );
  process.exit(1);
});
