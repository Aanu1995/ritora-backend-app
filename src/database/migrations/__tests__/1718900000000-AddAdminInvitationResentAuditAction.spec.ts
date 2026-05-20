import { AddAdminInvitationResentAuditAction1718900000000 } from '../1718900000000-AddAdminInvitationResentAuditAction';

describe('AddAdminInvitationResentAuditAction1718900000000', () => {
  it('creates the admin audit enum when recorded migration history drifted from schema state', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    };

    await new AddAdminInvitationResentAuditAction1718900000000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain("typname = 'admin_audit_action'");
    expect(sql).toContain('CREATE TYPE "admin_audit_action" AS ENUM');
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'admin_invitation_resent'");
  });
});
