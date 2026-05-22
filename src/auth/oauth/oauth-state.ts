export const GOOGLE_OAUTH_STATE_COOKIE = 'ritora_google_oauth_state';
export const GOOGLE_OAUTH_CONTEXT_COOKIE = 'ritora_google_oauth_context';
export const APPLE_OAUTH_STATE_COOKIE = 'ritora_apple_oauth_state';
export const APPLE_OAUTH_CONTEXT_COOKIE = 'ritora_apple_oauth_context';
export const OAUTH_STATE_BYTES = 32;

export type OAuthStartContext = {
  preferredLanguage: string;
  termsAccepted: boolean;
  privacyPolicyAccepted: boolean;
};
