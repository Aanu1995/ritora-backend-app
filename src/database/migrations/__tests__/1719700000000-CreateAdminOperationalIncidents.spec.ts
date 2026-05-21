import { readFileSync } from 'fs';
import { join } from 'path';

describe('CreateAdminOperationalIncidents migration', () => {
  it('creates auditable operational incident tracking with source dedupe indexes', () => {
    const sql = readFileSync(
      join(__dirname, '../1719700000000-CreateAdminOperationalIncidents.ts'),
      'utf8',
    );

    expect(sql).toContain('CREATE TYPE "admin_operational_incident_status"');
    expect(sql).toContain('CREATE TYPE "admin_operational_incident_severity"');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "admin_operational_incidents"',
    );
    expect(sql).toContain('"description" text NOT NULL');
    expect(sql).toContain('"resolution_summary" text');
    expect(sql).toContain('idx_admin_operational_incidents_status_created');
    expect(sql).toContain('idx_admin_operational_incidents_open_source');
    expect(sql).toContain('WHERE "status" = \'open\'');
    expect(sql).toContain(
      'REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT',
    );
    expect(sql).toContain('REFERENCES "users" ("id") ON DELETE SET NULL');
    expect(sql).toContain(
      "ADD VALUE IF NOT EXISTS 'operational_incident_created'",
    );
    expect(sql).toContain(
      "ADD VALUE IF NOT EXISTS 'operational_incident_resolved'",
    );
  });
});
