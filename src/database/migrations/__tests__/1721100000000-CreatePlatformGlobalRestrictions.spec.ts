import { CreatePlatformGlobalRestrictions1721100000000 } from '../1721100000000-CreatePlatformGlobalRestrictions';

describe('CreatePlatformGlobalRestrictions1721100000000', () => {
  it('creates indexed, audited platform-wide kill switch storage defensively', async () => {
    const query = jest.fn();
    const queryRunner = { query } as never;

    await new CreatePlatformGlobalRestrictions1721100000000().up(queryRunner);

    const sql = query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "platform_global_restrictions"',
    );
    expect(sql).toContain('disable_account_creation');
    expect(sql).toContain('disable_ai_generation');
    expect(sql).toContain('idx_platform_global_restrictions_active_lookup');
    expect(sql).toContain('idx_platform_global_restrictions_open_capability');
    expect(sql).toContain("typname = 'admin_audit_action'");
    expect(sql).toContain('platform_global_restriction_enabled');
    expect(sql).toContain('platform_global_restriction_disabled');
  });
});
