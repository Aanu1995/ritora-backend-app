export enum UserRestrictionCapability {
  DisableLogin = 'disable_login',
  DisableAiGeneration = 'disable_ai_generation',
  DisableImageUpload = 'disable_image_upload',
  DisableProductExtraction = 'disable_product_extraction',
  DisableNotifications = 'disable_notifications',
  DisableSupportContact = 'disable_support_contact',
  ForceEmailReverification = 'force_email_reverification',
  ForceLogout = 'force_logout',
}

export const USER_RESTRICTION_CAPABILITIES = Object.values(
  UserRestrictionCapability,
);

const USER_RESTRICTION_CAPABILITY_SET = new Set<string>(
  USER_RESTRICTION_CAPABILITIES,
);

export const LEGACY_USER_RESTRICTION_CAPABILITIES: readonly UserRestrictionCapability[] =
  [
    UserRestrictionCapability.DisableLogin,
    UserRestrictionCapability.ForceLogout,
  ];

export type RestrictableUser = {
  account_restricted_at?: Date | string | null;
  account_restriction_capabilities?: readonly string[] | null;
  account_restriction_expires_at?: Date | string | null;
};

export type MutableUserRestrictionState = RestrictableUser & {
  account_restricted_by_admin_id?: string | null;
  account_restriction_internal_note?: string | null;
  account_restriction_reason?: string | null;
  account_restriction_user_message?: string | null;
};

function toRestrictionDate(
  value: Date | string | null | undefined,
): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeUserRestrictionCapabilities(
  capabilities: readonly string[] | null | undefined,
): UserRestrictionCapability[] {
  if (!capabilities || capabilities.length === 0) {
    return [];
  }

  const normalized: UserRestrictionCapability[] = [];
  for (const capability of capabilities) {
    if (
      USER_RESTRICTION_CAPABILITY_SET.has(capability) &&
      !normalized.includes(capability as UserRestrictionCapability)
    ) {
      normalized.push(capability as UserRestrictionCapability);
    }
  }

  return normalized;
}

export function getEffectiveUserRestrictionCapabilities(
  user: RestrictableUser,
): UserRestrictionCapability[] {
  const capabilities = normalizeUserRestrictionCapabilities(
    user.account_restriction_capabilities,
  );

  if (capabilities.length > 0) {
    return capabilities;
  }

  return user.account_restricted_at
    ? [...LEGACY_USER_RESTRICTION_CAPABILITIES]
    : [];
}

export function isUserRestrictionActive(
  user: RestrictableUser,
  now = new Date(),
): boolean {
  if (!user.account_restricted_at) {
    return false;
  }

  const expiresAt = toRestrictionDate(user.account_restriction_expires_at);
  return !expiresAt || expiresAt.getTime() > now.getTime();
}

export function isUserRestrictionExpired(
  user: RestrictableUser,
  now = new Date(),
): boolean {
  if (!user.account_restricted_at) {
    return false;
  }

  const expiresAt = toRestrictionDate(user.account_restriction_expires_at);
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

export function clearUserRestrictionState(
  user: MutableUserRestrictionState,
): void {
  user.account_restricted_at = null;
  user.account_restricted_by_admin_id = null;
  user.account_restriction_capabilities = null;
  user.account_restriction_expires_at = null;
  user.account_restriction_internal_note = null;
  user.account_restriction_reason = null;
  user.account_restriction_user_message = null;
}

export function hasActiveUserRestrictionCapability(
  user: RestrictableUser,
  capability: UserRestrictionCapability,
  now = new Date(),
): boolean {
  if (!isUserRestrictionActive(user, now)) {
    return false;
  }

  return getEffectiveUserRestrictionCapabilities(user).includes(capability);
}
