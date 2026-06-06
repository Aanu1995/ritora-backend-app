import { assertDestructiveTestDatabaseResetAllowed } from './destructive-database-guard';

describe('assertDestructiveTestDatabaseResetAllowed', () => {
  const originalFlag = process.env.RITORA_ALLOW_DESTRUCTIVE_TEST_DB_RESET;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.RITORA_ALLOW_DESTRUCTIVE_TEST_DB_RESET;
    } else {
      process.env.RITORA_ALLOW_DESTRUCTIVE_TEST_DB_RESET = originalFlag;
    }
  });

  it('refuses destructive cleanup unless the explicit allow flag is set', () => {
    delete process.env.RITORA_ALLOW_DESTRUCTIVE_TEST_DB_RESET;

    expect(() =>
      assertDestructiveTestDatabaseResetAllowed({
        databaseName: 'ritora_test',
        operation: 'e2e truncate',
      }),
    ).toThrow(/disabled/i);
  });

  it('refuses the normal development database even when the allow flag is set', () => {
    process.env.RITORA_ALLOW_DESTRUCTIVE_TEST_DB_RESET = 'true';

    expect(() =>
      assertDestructiveTestDatabaseResetAllowed({
        databaseName: 'ritora',
        operation: 'e2e truncate',
      }),
    ).toThrow(/refused for database "ritora"/i);
  });

  it('allows explicitly disposable database names with the allow flag', () => {
    process.env.RITORA_ALLOW_DESTRUCTIVE_TEST_DB_RESET = 'true';

    expect(() =>
      assertDestructiveTestDatabaseResetAllowed({
        databaseName: 'ritora_test',
        operation: 'e2e truncate',
      }),
    ).not.toThrow();
  });
});
