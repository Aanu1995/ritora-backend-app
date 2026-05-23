const DESTRUCTIVE_DB_RESET_FLAG = 'RITORA_ALLOW_DESTRUCTIVE_TEST_DB_RESET';

const DISPOSABLE_DATABASE_NAME_PATTERN =
  /(^|[_-])(test|e2e|ci|tmp|temp|throwaway|disposable|sandbox)([_-]|$)/i;

const NEVER_RESET_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
  'ritora',
  'prod',
  'production',
]);

export function assertDestructiveTestDatabaseResetAllowed(input: {
  databaseName: unknown;
  operation: string;
}): void {
  const databaseName =
    typeof input.databaseName === 'string' ? input.databaseName.trim() : '';
  const allowFlag = process.env[DESTRUCTIVE_DB_RESET_FLAG] === 'true';

  if (!allowFlag) {
    throw new Error(
      [
        `${input.operation} refused: destructive database cleanup is disabled.`,
        `Set ${DESTRUCTIVE_DB_RESET_FLAG}=true only for a disposable test database.`,
      ].join(' '),
    );
  }

  if (!databaseName) {
    throw new Error(
      `${input.operation} refused: database name could not be determined.`,
    );
  }

  if (
    NEVER_RESET_DATABASE_NAMES.has(databaseName.toLowerCase()) ||
    !DISPOSABLE_DATABASE_NAME_PATTERN.test(databaseName)
  ) {
    throw new Error(
      [
        `${input.operation} refused for database "${databaseName}".`,
        'Destructive test cleanup may only run against a clearly disposable database name',
        '(for example ritora_test, ritora_e2e, or ritora_ci).',
      ].join(' '),
    );
  }
}
