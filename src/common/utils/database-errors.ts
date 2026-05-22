const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

export function isPostgresUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION_CODE
  );
}
