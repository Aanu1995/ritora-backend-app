import { DataSource } from 'typeorm';
import { PlatformGlobalRestrictionsService } from './platform-global-restrictions.service';
import { PlatformGlobalRestrictionCapability } from './platform-global-restrictions';

describe('PlatformGlobalRestrictionsService', () => {
  it('uses one indexed lookup and allows actions when no global restriction is active', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new PlatformGlobalRestrictionsService({
      query,
    } as unknown as DataSource);

    await expect(
      service.assertAllAllowed([
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
        PlatformGlobalRestrictionCapability.DisableImageUpload,
      ]),
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'idx_platform_global_restrictions_active_lookup',
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'UPDATE platform_global_restrictions',
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "disable_reason = 'Expired automatically'",
    );
    expect(String(query.mock.calls[0]?.[0])).toContain('LIMIT 1');
    expect(query.mock.calls[0]?.[1]).toEqual([
      [
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
        PlatformGlobalRestrictionCapability.DisableImageUpload,
      ],
    ]);
  });

  it('blocks the first active matching global restriction without exposing admin notes', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
      },
    ]);
    const service = new PlatformGlobalRestrictionsService({
      query,
    } as unknown as DataSource);

    await expect(
      service.assertAllowed(
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
      ),
    ).rejects.toMatchObject({
      response: {
        capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
        code: 'PLATFORM_GLOBAL_RESTRICTION_ACTIVE',
        message: 'Platform feature temporarily disabled',
      },
    });
  });

  it('soft-closes expired matching rows before checking active global restrictions', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new PlatformGlobalRestrictionsService({
      query,
    } as unknown as DataSource);

    await service.assertAllowed(
      PlatformGlobalRestrictionCapability.DisableImageUpload,
    );

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('expires_at <= now()');
    expect(sql).toContain('capability = ANY($1::varchar[])');
    expect(query.mock.calls[0]?.[1]).toEqual([
      [PlatformGlobalRestrictionCapability.DisableImageUpload],
    ]);
  });
});
