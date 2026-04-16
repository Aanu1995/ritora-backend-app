export const RESEND_CLIENT = Symbol('RESEND_CLIENT');

export const DEFAULT_MAIL_FROM = 'onboarding@resend.dev';

export const MAIL_PROVIDER_LABEL = 'Resend API';

export enum MailTemplateName {
  Verification = 'verification',
  PasswordReset = 'password-reset',
}

export const MAIL_SUBJECTS: Record<MailTemplateName, string> = {
  [MailTemplateName.Verification]: 'Verify your Ritora account',
  [MailTemplateName.PasswordReset]: 'Reset your Ritora password',
};
