import { DataSource } from 'typeorm';

export async function deleteUserRowsIfTableExists(
  dataSource: DataSource,
  tableName: string,
  deleteRows: () => Promise<unknown>,
  options: { required?: boolean } = {},
): Promise<void> {
  const exists = await tableExists(dataSource, tableName);
  if (!exists) {
    if (options.required === false) {
      return;
    }
    throw new Error(
      `Required table ${tableName} is missing. Run migrations before seeding.`,
    );
  }
  await deleteRows();
}

async function tableExists(
  dataSource: DataSource,
  tableName: string,
): Promise<boolean> {
  const rows: unknown = await dataSource.query(
    'SELECT to_regclass($1) AS table_name',
    [`public.${tableName}`],
  );
  if (!Array.isArray(rows)) {
    return false;
  }
  const first: unknown = (rows as unknown[])[0];
  return isRecord(first) && typeof first.table_name === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
