export const RESEND_CLIENT = Symbol('RESEND_CLIENT');

export const DEFAULT_MAIL_FROM = 'onboarding@resend.dev';

export const MAIL_PROVIDER_LABEL = 'Resend API';

export enum MailTemplateName {
  Verification = 'verification',
  PasswordReset = 'password-reset',
  NotificationPhotoReminder = 'notification-photo-reminder',
  NotificationSuggestionReady = 'notification-suggestion-ready',
  NotificationSlotStart = 'notification-slot-start',
  NotificationRecordingReminder = 'notification-recording-reminder',
  NotificationReactionDetected = 'notification-reaction-detected',
  NotificationSimplificationStarted = 'notification-simplification-started',
  NotificationInsightReady = 'notification-insight-ready',
  NotificationDoctorReferral = 'notification-doctor-referral',
  NotificationWrappedReady = 'notification-wrapped-ready',
}

export const NOTIFICATION_PARTIALS: ReadonlyArray<{
  name: string;
  fileName: string;
}> = [
  { name: '_header', fileName: '_header.hbs' },
  { name: '_footer', fileName: '_footer.hbs' },
  { name: '_cta', fileName: '_cta.hbs' },
];

export const NOTIFICATION_SUPPORT_EMAIL = 'support@getritora.com';

export type NotificationEmailKind =
  | 'photo_reminder'
  | 'suggestion_ready'
  | 'slot_start'
  | 'recording_reminder'
  | 'reaction_detected'
  | 'simplification_started'
  | 'insight_ready'
  | 'doctor_referral'
  | 'wrapped_ready';

export const NOTIFICATION_KIND_TEMPLATE: Record<
  NotificationEmailKind,
  MailTemplateName
> = {
  photo_reminder: MailTemplateName.NotificationPhotoReminder,
  suggestion_ready: MailTemplateName.NotificationSuggestionReady,
  slot_start: MailTemplateName.NotificationSlotStart,
  recording_reminder: MailTemplateName.NotificationRecordingReminder,
  reaction_detected: MailTemplateName.NotificationReactionDetected,
  simplification_started: MailTemplateName.NotificationSimplificationStarted,
  insight_ready: MailTemplateName.NotificationInsightReady,
  doctor_referral: MailTemplateName.NotificationDoctorReferral,
  wrapped_ready: MailTemplateName.NotificationWrappedReady,
};

export const NOTIFICATION_KINDS_WITHOUT_LIST_UNSUBSCRIBE: ReadonlySet<NotificationEmailKind> =
  new Set(['reaction_detected']);
