import { Injectable } from '@nestjs/common';
import {
  PlatformGlobalRestrictionCapability,
  PLATFORM_GLOBAL_RESTRICTION_CAPABILITIES,
} from '../platform-controls/platform-global-restrictions';
import {
  type ActivePlatformGlobalRestriction,
  PlatformGlobalRestrictionsService,
} from '../platform-controls/platform-global-restrictions.service';
import { toIsoString } from '../common/utils/date';
import {
  UserCapabilitiesDto,
  UserFeatureAccessBlockedBy,
  UserFeatureAccessDto,
} from './dto/user-capabilities.dto';
import { User } from './entities/user.entity';
import {
  getEffectiveUserRestrictionCapabilities,
  isUserRestrictionActive,
  UserRestrictionCapability,
} from './user-restrictions';

type CapabilityName = keyof UserCapabilitiesDto;

type CapabilityConfig = {
  user: readonly UserRestrictionCapability[];
  platform: readonly PlatformGlobalRestrictionCapability[];
};

const CAPABILITY_CONFIG: Record<CapabilityName, CapabilityConfig> = {
  accountCreation: {
    user: [],
    platform: [PlatformGlobalRestrictionCapability.DisableAccountCreation],
  },
  aiGeneration: {
    user: [UserRestrictionCapability.DisableAiGeneration],
    platform: [PlatformGlobalRestrictionCapability.DisableAiGeneration],
  },
  imageUpload: {
    user: [UserRestrictionCapability.DisableImageUpload],
    platform: [PlatformGlobalRestrictionCapability.DisableImageUpload],
  },
  productExtraction: {
    user: [UserRestrictionCapability.DisableProductExtraction],
    platform: [PlatformGlobalRestrictionCapability.DisableProductExtraction],
  },
  notifications: {
    user: [UserRestrictionCapability.DisableNotifications],
    platform: [PlatformGlobalRestrictionCapability.DisableNotifications],
  },
  supportContact: {
    user: [UserRestrictionCapability.DisableSupportContact],
    platform: [],
  },
};

const CAPABILITY_NAMES = Object.keys(
  CAPABILITY_CONFIG,
) as readonly CapabilityName[];

@Injectable()
export class UserCapabilitySnapshotService {
  constructor(
    private readonly platformRestrictions: PlatformGlobalRestrictionsService,
  ) {}

  async buildForUser(
    user: User,
    now = new Date(),
  ): Promise<UserCapabilitiesDto> {
    const platformByCapability = await this.getPlatformRestrictionMap();
    const userCapabilities = isUserRestrictionActive(user, now)
      ? getEffectiveUserRestrictionCapabilities(user)
      : [];

    return this.buildCapabilities({
      platformByCapability,
      user,
      userCapabilities,
    });
  }

  async buildPublicPlatformCapabilities(): Promise<UserCapabilitiesDto> {
    return this.buildCapabilities({
      platformByCapability: await this.getPlatformRestrictionMap(),
      user: null,
      userCapabilities: [],
    });
  }

  private buildCapabilities(input: {
    platformByCapability: ReadonlyMap<
      PlatformGlobalRestrictionCapability,
      ActivePlatformGlobalRestriction
    >;
    user: User | null;
    userCapabilities: readonly UserRestrictionCapability[];
  }): UserCapabilitiesDto {
    const init = {} as UserCapabilitiesDto;

    for (const name of CAPABILITY_NAMES) {
      init[name] = this.buildFeatureAccess({
        config: CAPABILITY_CONFIG[name],
        platformByCapability: input.platformByCapability,
        user: input.user,
        userCapabilities: input.userCapabilities,
      });
    }

    return new UserCapabilitiesDto(init);
  }

  private buildFeatureAccess(input: {
    config: CapabilityConfig;
    platformByCapability: ReadonlyMap<
      PlatformGlobalRestrictionCapability,
      ActivePlatformGlobalRestriction
    >;
    user: User | null;
    userCapabilities: readonly UserRestrictionCapability[];
  }): UserFeatureAccessDto {
    if (
      input.config.user.some((capability) =>
        input.userCapabilities.includes(capability),
      )
    ) {
      return new UserFeatureAccessDto(
        false,
        UserFeatureAccessBlockedBy.UserRestriction,
        dateToIsoString(input.user?.account_restriction_expires_at),
        normalizeUserMessage(input.user?.account_restriction_user_message),
      );
    }

    for (const capability of input.config.platform) {
      const restriction = input.platformByCapability.get(capability);
      if (restriction) {
        return new UserFeatureAccessDto(
          false,
          UserFeatureAccessBlockedBy.PlatformGlobalRestriction,
          dateToIsoString(restriction.expiresAt),
          null,
        );
      }
    }

    return new UserFeatureAccessDto(true, null, null, null);
  }

  private async getPlatformRestrictionMap(): Promise<
    ReadonlyMap<
      PlatformGlobalRestrictionCapability,
      ActivePlatformGlobalRestriction
    >
  > {
    const platformRestrictions =
      await this.platformRestrictions.listActiveRestrictions(
        PLATFORM_GLOBAL_RESTRICTION_CAPABILITIES,
      );

    return new Map(
      platformRestrictions.map((restriction) => [
        restriction.capability,
        restriction,
      ]),
    );
  }
}

function dateToIsoString(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  if (value instanceof Date) return toIsoString(value);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : toIsoString(parsed);
}

function normalizeUserMessage(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}
