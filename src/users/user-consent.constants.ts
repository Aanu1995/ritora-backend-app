export enum UserConsentType {
  TermsOfService = 'terms_of_service',
  PrivacyPolicy = 'privacy_policy',
  LocationProcessing = 'location_processing',
  HealthContextProcessing = 'health_context_processing',
  HormonalContextProcessing = 'hormonal_context_processing',
}

export const SENSITIVE_SKIN_PROFILE_CONSENT_TYPES = [
  UserConsentType.LocationProcessing,
  UserConsentType.HealthContextProcessing,
  UserConsentType.HormonalContextProcessing,
] as const;

export type SensitiveSkinProfileConsentType =
  (typeof SENSITIVE_SKIN_PROFILE_CONSENT_TYPES)[number];

export enum UserDataAccessEventType {
  DataAccessed = 'data_accessed',
  ConsentGranted = 'consent_granted',
  ConsentRevoked = 'consent_revoked',
}

export enum UserDataAccessActorType {
  User = 'user',
  System = 'system',
}

export enum UserDataAccessPurpose {
  SkinProfileRead = 'skin_profile_read',
  RecommendationAnalysis = 'recommendation_analysis',
  AccountExport = 'account_export',
  ConsentGrant = 'consent_grant',
  ConsentRevoke = 'consent_revoke',
}
