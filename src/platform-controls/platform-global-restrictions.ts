export enum PlatformGlobalRestrictionCapability {
  DisableAccountCreation = 'disable_account_creation',
  DisableAiGeneration = 'disable_ai_generation',
  DisableImageUpload = 'disable_image_upload',
  DisableProductExtraction = 'disable_product_extraction',
  DisableNotifications = 'disable_notifications',
}

export const PLATFORM_GLOBAL_RESTRICTION_CAPABILITIES = Object.values(
  PlatformGlobalRestrictionCapability,
);

const PLATFORM_GLOBAL_RESTRICTION_CAPABILITY_SET = new Set<string>(
  PLATFORM_GLOBAL_RESTRICTION_CAPABILITIES,
);

export function isPlatformGlobalRestrictionCapability(
  value: string,
): value is PlatformGlobalRestrictionCapability {
  return PLATFORM_GLOBAL_RESTRICTION_CAPABILITY_SET.has(value);
}

export function normalizePlatformGlobalRestrictionCapabilities(
  capabilities: readonly string[] | null | undefined,
): PlatformGlobalRestrictionCapability[] {
  if (!capabilities || capabilities.length === 0) {
    return [];
  }

  const normalized: PlatformGlobalRestrictionCapability[] = [];
  for (const capability of capabilities) {
    if (
      isPlatformGlobalRestrictionCapability(capability) &&
      !normalized.includes(capability)
    ) {
      normalized.push(capability);
    }
  }

  return normalized;
}
