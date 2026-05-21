import { QueryRunner } from 'typeorm';
import { AddAdminProductHealthQueryIndexes1720200000000 } from '../1720200000000-AddAdminProductHealthQueryIndexes';

describe('AddAdminProductHealthQueryIndexes1720200000000', () => {
  it('adds covering indexes for admin product health query paths', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddAdminProductHealthQueryIndexes1720200000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('idx_product_analytics_events_type_user');
    expect(sql).toContain('idx_product_analytics_events_user_occurred_type');
    expect(sql).toContain('idx_product_analytics_events_type_occurred_user');
    expect(sql).toContain('idx_http_request_metrics_recent_rollup');
    expect(sql).toContain('INCLUDE ("duration_ms", "status_code")');
    expect(sql).toContain('idx_users_email_verified_true');
    expect(sql).toContain('idx_user_data_access_logs_created_at_desc');
    expect(sql).toContain(
      'idx_admin_audit_logs_target_user_created_at_id_desc',
    );
    expect(sql).toContain(
      'idx_admin_audit_logs_target_admin_created_at_id_desc',
    );
    expect(sql).toContain('idx_skin_journal_entries_ai_cost_started');
    expect(sql).toContain('idx_suggestion_instances_ai_cost_generated');
    expect(sql).toContain('idx_skin_journal_entries_analysis_status');
    expect(sql).toContain('idx_smart_pick_generation_jobs_status');
  });
});
