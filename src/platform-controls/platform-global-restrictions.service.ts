import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  normalizePlatformGlobalRestrictionCapabilities,
  PlatformGlobalRestrictionCapability,
} from './platform-global-restrictions';

type QueryRow = Record<string, unknown>;

export type ActivePlatformGlobalRestriction = {
  capability: PlatformGlobalRestrictionCapability;
  expiresAt: Date | null;
};

@Injectable()
export class PlatformGlobalRestrictionsService {
  constructor(private readonly dataSource: DataSource) {}

  async assertAllowed(
    capability: PlatformGlobalRestrictionCapability,
  ): Promise<void> {
    await this.assertAllAllowed([capability]);
  }

  async assertAllAllowed(
    capabilities: readonly PlatformGlobalRestrictionCapability[],
  ): Promise<void> {
    const normalized =
      normalizePlatformGlobalRestrictionCapabilities(capabilities);
    if (normalized.length === 0) {
      return;
    }

    const activeRestriction = await this.findFirstActiveRestriction(normalized);
    if (!activeRestriction) {
      return;
    }

    throw new ForbiddenException({
      capability: activeRestriction,
      code: 'PLATFORM_GLOBAL_RESTRICTION_ACTIVE',
      message: 'Platform feature temporarily disabled',
    });
  }

  async isCapabilityDisabled(
    capability: PlatformGlobalRestrictionCapability,
  ): Promise<boolean> {
    return Boolean(await this.findFirstActiveRestriction([capability]));
  }

  async listActiveRestrictions(
    capabilities: readonly PlatformGlobalRestrictionCapability[],
  ): Promise<ActivePlatformGlobalRestriction[]> {
    const normalized =
      normalizePlatformGlobalRestrictionCapabilities(capabilities);
    if (normalized.length === 0) {
      return [];
    }

    const rows = toQueryRows(
      await this.dataSource.query(
        `
          WITH expired_restrictions AS (
            UPDATE platform_global_restrictions
            SET
              disabled_at = expires_at,
              disabled_by_admin_id = NULL,
              disable_reason = 'Expired automatically',
              updated_at = now()
            WHERE disabled_at IS NULL
              AND expires_at IS NOT NULL
              AND expires_at <= now()
              AND capability = ANY($1::varchar[])
            RETURNING id
          )
          SELECT DISTINCT ON (capability)
            capability,
            expires_at AS "expiresAt"
          FROM platform_global_restrictions
          WHERE disabled_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
            AND capability = ANY($1::varchar[])
          ORDER BY capability, enabled_at DESC, id DESC
          /* idx_platform_global_restrictions_active_lookup */
        `,
        [normalized],
      ),
    );

    return rows.flatMap((row) => {
      const capability = row.capability;
      if (typeof capability !== 'string') {
        return [];
      }

      return [
        {
          capability: capability as PlatformGlobalRestrictionCapability,
          expiresAt: toNullableDate(row.expiresAt),
        },
      ];
    });
  }

  private async findFirstActiveRestriction(
    capabilities: readonly PlatformGlobalRestrictionCapability[],
  ): Promise<PlatformGlobalRestrictionCapability | null> {
    const rows = toQueryRows(
      await this.dataSource.query(
        `
          WITH expired_restrictions AS (
            UPDATE platform_global_restrictions
            SET
              disabled_at = expires_at,
              disabled_by_admin_id = NULL,
              disable_reason = 'Expired automatically',
              updated_at = now()
            WHERE disabled_at IS NULL
              AND expires_at IS NOT NULL
              AND expires_at <= now()
              AND capability = ANY($1::varchar[])
            RETURNING id
          )
          SELECT capability
          FROM platform_global_restrictions
          WHERE disabled_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
            AND capability = ANY($1::varchar[])
          ORDER BY enabled_at DESC, id DESC
          LIMIT 1
          /* idx_platform_global_restrictions_active_lookup */
        `,
        [capabilities],
      ),
    );
    const capability = rows[0]?.capability;

    return typeof capability === 'string'
      ? (capability as PlatformGlobalRestrictionCapability)
      : null;
  }
}

function toQueryRows(value: unknown): QueryRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is QueryRow =>
        Boolean(row && typeof row === 'object'),
      )
    : [];
}

function toNullableDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
