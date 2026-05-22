import type { Request } from 'express';

export const SUPPORTED_LANGUAGES = ['en', 'sv'] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: AppLanguage = 'en';

type TranslationDictionary = Record<string, string>;

type RequestWithLanguageUser = Request & {
  user?: {
    language?: unknown;
    preferred_language?: unknown;
  };
};

const translations: Record<AppLanguage, TranslationDictionary> = {
  en: {
    'messages.auth.register.verifyEmail':
      'Verify your email to activate your account',
    'messages.auth.verifyEmail.success': 'Email verified successfully',
    'messages.auth.resendVerification.success':
      'If the email is registered, a verification link has been sent',
    'messages.auth.forgotPassword.success':
      'If the email is registered, a reset link has been sent',
    'messages.auth.resetPassword.success': 'Password reset successfully',
    'messages.adminAuth.forgotPassword.success':
      'If the email is registered, a reset link has been sent',
    'messages.adminAuth.resetPassword.success': 'Password reset successfully',
    'messages.auth.logout.success': 'Logged out',
    'messages.auth.logoutAll.success': 'All sessions revoked',
    'messages.auth.deleteAccount.success': 'Account deleted',
    'messages.auth.deleteAccount.scheduled': 'Account deletion scheduled',
    'messages.auth.deleteAccount.confirmationRequired':
      'Check your email to confirm account deletion',
    'messages.auth.deleteAccount.cancelled':
      'Account deletion has been cancelled',
    'mail.subject.verification': 'Verify your Ritora account',
    'mail.subject.passwordReset': 'Reset your Ritora password',
    'mail.subject.adminInvitation': 'You have been invited to Ritora Admin',
    'mail.subject.adminPasswordReset': 'Reset your Ritora admin password',
    'mail.subject.accountDeletionConfirm':
      'Confirm deletion of your Ritora account',
    'mail.subject.accountDeletionScheduled':
      'Your Ritora account will be deleted on {{scheduledFor}}',
    'mail.subject.accountDeletionCancelled':
      'Good news, your Ritora account is staying',
    'mail.verification.previewText':
      'Welcome to Ritora. Tap the button inside to confirm your email and start building a calmer skincare routine.',
    'mail.verification.title': 'Welcome to Ritora, {{firstName}}',
    'mail.verification.intro':
      'Tap the button below to confirm your email and finish setting up your account.',
    'mail.verification.ctaLabel': 'Confirm email',
    'mail.verification.expiry':
      'This link works for the next 24 hours and can only be used once.',
    'mail.verification.fallbackIntro':
      'If the button does not open, copy and paste this link into your browser.',
    'mail.verification.ignore':
      'If you did not sign up for Ritora, you can ignore this email. Nothing will happen to your address.',
    'mail.verification.footerLineOne':
      'Sent from Ritora. We help you build a calmer skincare routine from the shelf you already own.',
    'mail.verification.footerLineTwo':
      'Need a hand? Write to us at support@getritora.com.',
    'mail.passwordReset.previewText':
      'Reset your Ritora password. This link works for the next hour.',
    'mail.passwordReset.title': 'Reset your password',
    'mail.passwordReset.intro':
      'Hi {{firstName}}, we got a request to reset the password on your Ritora account. Tap the button below to pick a new one.',
    'mail.passwordReset.ctaLabel': 'Pick a new password',
    'mail.passwordReset.expiry':
      'This link works for the next hour and can only be used once.',
    'mail.passwordReset.fallbackIntro':
      'If the button does not open, copy and paste this link into your browser.',
    'mail.passwordReset.unexpectedTitle': 'Did you not ask for this?',
    'mail.passwordReset.unexpectedBody':
      'You can ignore this email and your current password will keep working. Ritora will never ask for your password by email.',
    'mail.passwordReset.footerLine':
      'Sent from Ritora. If you ever have questions about your account, the team is at support@getritora.com.',
    'mail.adminInvitation.previewText':
      'Set your Ritora Admin password to accept your invitation.',
    'mail.adminInvitation.title': 'Accept your Ritora Admin invitation',
    'mail.adminInvitation.intro':
      '{{invitedByName}} invited you to help manage Ritora. Set a password to accept the invitation.',
    'mail.adminInvitation.ctaLabel': 'Set admin password',
    'mail.adminInvitation.expiry':
      'This invitation works for the next 7 days and can only be used once.',
    'mail.adminInvitation.unexpectedTitle': 'Not expecting this?',
    'mail.adminInvitation.unexpectedBody':
      'Ignore this email if you were not expecting access. Ritora will never ask for your password by email.',
    'mail.adminInvitation.footerLine':
      'Sent from Ritora for internal account safety. Questions? Write to support@getritora.com.',
    'mail.adminPasswordReset.previewText':
      'Reset your Ritora Admin password. This link works for the next hour.',
    'mail.adminPasswordReset.title': 'Reset your admin password',
    'mail.adminPasswordReset.intro':
      'Hi {{firstName}}, we got a request to reset your Ritora Admin password.',
    'mail.adminPasswordReset.ctaLabel': 'Pick a new password',
    'mail.adminPasswordReset.footerLine':
      'Sent from Ritora for internal account safety. Questions? Write to support@getritora.com.',
    'mail.accountDeletion.confirm.previewText':
      'Tap to confirm you want to delete your Ritora account. The link expires in one hour.',
    'mail.accountDeletion.confirm.badgeLabel': 'Action needed',
    'mail.accountDeletion.confirm.title':
      'Confirm account deletion, {{firstName}}',
    'mail.accountDeletion.confirm.intro':
      'We got a request to delete your Ritora account. Only confirm below if this was you. The link works for the next hour.',
    'mail.accountDeletion.confirm.ctaLabel': 'Confirm deletion',
    'mail.accountDeletion.confirm.timelineTitle': 'Here is what happens next',
    'mail.accountDeletion.confirm.timeline1Title': 'You confirm',
    'mail.accountDeletion.confirm.timeline1Body':
      'We sign you out of every device and start your 30-day grace period.',
    'mail.accountDeletion.confirm.timeline2Title': 'Next 30 days',
    'mail.accountDeletion.confirm.timeline2Body':
      'Change your mind any time. Sign in again or use the cancellation link in your inbox.',
    'mail.accountDeletion.confirm.timeline3Title': 'After day 30',
    'mail.accountDeletion.confirm.timeline3Body':
      'Your profile, photos, shelf, and history are permanently deleted.',
    'mail.accountDeletion.confirm.note':
      'This link expires in 1 hour and can only be used once.',
    'mail.accountDeletion.confirm.fallbackIntro':
      'Button not working? Copy and paste this link into your browser.',
    'mail.accountDeletion.confirm.ignoreNote':
      'Did not ask for this? You can ignore this email. Your account stays active and nothing changes.',
    'mail.accountDeletion.confirm.footerLine':
      'Sent from Ritora for account safety. Questions? Write to support@getritora.com.',
    'mail.accountDeletion.scheduled.previewText':
      'Your Ritora account is scheduled for deletion on {{scheduledFor}}. Cancel anytime before then.',
    'mail.accountDeletion.scheduled.badgeLabel': 'Scheduled · {{scheduledFor}}',
    'mail.accountDeletion.scheduled.title':
      'Your account is scheduled for deletion',
    'mail.accountDeletion.scheduled.intro':
      'Hi {{firstName}}, your Ritora account is set to be permanently deleted on {{scheduledFor}}. You have 30 days to change your mind.',
    'mail.accountDeletion.scheduled.ctaLabel': 'Cancel deletion',
    'mail.accountDeletion.scheduled.timelineTitle': 'Your 30-day grace period',
    'mail.accountDeletion.scheduled.timeline1Title': 'Today',
    'mail.accountDeletion.scheduled.timeline1Body':
      'All sessions signed out. Your data is held safely and not used.',
    'mail.accountDeletion.scheduled.timeline2Title':
      'Anytime before {{scheduledFor}}',
    'mail.accountDeletion.scheduled.timeline2Body':
      'Tap "Cancel deletion" above, or simply sign in again to keep your account.',
    'mail.accountDeletion.scheduled.timeline3Title': 'On {{scheduledFor}}',
    'mail.accountDeletion.scheduled.timeline3Body':
      'Your profile, photos, shelf, and history are permanently erased. This cannot be undone.',
    'mail.accountDeletion.scheduled.note':
      'If this was not you, cancel now and reset your password. Ritora will never ask for your password by email.',
    'mail.accountDeletion.scheduled.fallbackIntro':
      'Button not working? Copy and paste this link into your browser.',
    'mail.accountDeletion.scheduled.footerLine':
      'Sent from Ritora for account safety. Need help? Write to support@getritora.com.',
    'mail.accountDeletion.cancelled.previewText':
      'Good news. Your Ritora account is staying and nothing was deleted.',
    'mail.accountDeletion.cancelled.badgeLabel': 'Cancelled',
    'mail.accountDeletion.cancelled.title': 'Welcome back, {{firstName}}',
    'mail.accountDeletion.cancelled.intro':
      'Your deletion request has been cancelled. Your Ritora account is active and everything is exactly where you left it.',
    'mail.accountDeletion.cancelled.ctaLabel': 'Open Ritora',
    'mail.accountDeletion.cancelled.recapTitle': 'A quick recap',
    'mail.accountDeletion.cancelled.recapItem1':
      'Your profile, photos, and routine history are safe',
    'mail.accountDeletion.cancelled.recapItem2':
      'Your shelf, schedule, and suggestions are ready when you are',
    'mail.accountDeletion.cancelled.recapItem3':
      'No further action needed. Sign in anytime to pick up where you left off',
    'mail.accountDeletion.cancelled.note':
      'Did not cancel this yourself? Reset your password and review your active sessions. We will help — write to support@getritora.com.',
    'mail.accountDeletion.cancelled.fallbackIntro':
      'Button not working? Copy and paste this link into your browser.',
    'mail.accountDeletion.cancelled.footerLine':
      'Sent from Ritora for account safety. Questions? Write to support@getritora.com.',
    'mail.notification.shared.manageLabel': 'Manage notification preferences',
    'mail.notification.shared.supportLine': 'Need help? Reach us at',
    'mail.daypart.morning': 'morning',
    'mail.daypart.noon': 'midday',
    'mail.daypart.evening': 'evening',
    'mail.subject.photo_reminder': "Add today's skin photo",
    'mail.notification.photo_reminder.previewText':
      'A quick photo today keeps your progress honest.',
    'mail.notification.photo_reminder.title':
      "Time for today's photo, {{firstName}}",
    'mail.notification.photo_reminder.intro':
      'A quick photo in steady light is all your skin needs today. Ritora reads it for reactions, tracks how things are going, and shapes the suggestions ahead.',
    'mail.notification.photo_reminder.payloadLabel': 'TODAY · {{date}}',
    'mail.notification.photo_reminder.payloadTitle': 'No photo logged yet',
    'mail.notification.photo_reminder.payloadMeta':
      'Last photo: {{lastPhotoLabel}}',
    'mail.notification.photo_reminder.ctaLabel': "Add today's photo",
    'mail.notification.photo_reminder.tipNote':
      'Same window, same light. Ritora compares your photos across the last 14 days to spot the small changes you would miss.',
    'mail.notification.photo_reminder.footerWhy':
      'You are getting this because daily photo reminders are on.',
    'mail.notification.photo_reminder.unsubscribeLabel':
      'Unsubscribe from photo reminders',
    'mail.subject.suggestion_ready': 'Your {{slot}} routine is ready',
    'mail.notification.suggestion_ready.previewText':
      'Your routine is shaped and waiting on the Today page.',
    'mail.notification.suggestion_ready.title':
      'Your {{slot}} routine is ready',
    'mail.notification.suggestion_ready.intro':
      'Shaped around your skin today, what you applied last night, and the ingredients already on your shelf.',
    'mail.notification.suggestion_ready.slotLabel': '{{slot}} · {{slotTime}}',
    'mail.notification.suggestion_ready.stepSummary':
      '{{stepCount}} steps, about {{minutes}} minutes',
    'mail.notification.suggestion_ready.ctaLabel': "Open today's plan",
    'mail.notification.suggestion_ready.rationale':
      "Why these. Ritora left out anything that clashes with last night's actives, and kept your barrier light so today's SPF can do its job.",
    'mail.notification.suggestion_ready.footerWhy':
      'You are getting this because suggestion alerts are on.',
    'mail.notification.suggestion_ready.unsubscribeLabel':
      'Unsubscribe from suggestion alerts',
    'mail.subject.slot_start': 'Time for your {{slot}} routine',
    'mail.notification.slot_start.previewText':
      'Your {{slot}} routine is up and waiting.',
    'mail.notification.slot_start.title':
      'It is time, {{firstName}}. {{slot}} routine.',
    'mail.notification.slot_start.intro':
      '{{minutes}} minutes, {{stepCount}} steps, then your day is yours. We will nudge you in 30 if you forget to log it.',
    'mail.notification.slot_start.payloadLabel': 'SLOT NOW · {{slot}}',
    'mail.notification.slot_start.payloadTitle': '{{stepFlow}}',
    'mail.notification.slot_start.payloadMeta':
      'About {{minutes}} min. Gentle on your barrier. Finishes with SPF.',
    'mail.notification.slot_start.ctaLabel': 'Apply now',
    'mail.notification.slot_start.footerWhy':
      'You are getting this because slot start alerts are on.',
    'mail.notification.slot_start.unsubscribeLabel':
      'Unsubscribe from slot start alerts',
    'mail.subject.recording_reminder': 'Quick log: did you apply your routine?',
    'mail.notification.recording_reminder.previewText':
      'Ten seconds to log what you actually applied this {{slot}}.',
    'mail.notification.recording_reminder.title':
      'Did you apply your {{slot}} routine?',
    'mail.notification.recording_reminder.intro':
      'Ten seconds is all it takes. Log what actually went on so the next suggestion knows where to start.',
    'mail.notification.recording_reminder.slotLabel':
      '{{slot}} SLOT · {{slotTime}}',
    'mail.notification.recording_reminder.statusLabel': 'Awaiting record',
    'mail.notification.recording_reminder.stepsMeta':
      '{{stepCount}} suggested steps. Checklist already filled. About 10 seconds to confirm.',
    'mail.notification.recording_reminder.ctaLabel': 'Record {{slot}} now',
    'mail.notification.recording_reminder.skipNote':
      'Skipped today? <a class="email-link email-secondary-link" href="{{skipUrl}}" style="color: #6b7361; text-decoration: underline;">Mark this slot as skipped</a>. We will adapt without scolding.',
    'mail.notification.recording_reminder.footerWhy':
      'You are getting this because recording reminders are on.',
    'mail.notification.recording_reminder.unsubscribeLabel':
      'Unsubscribe from recording reminders',
    'mail.subject.reaction_detected': 'Your routine has been paused',
    'mail.notification.reaction_detected.previewText':
      'Routine paused. Your barrier is the priority for the next few days.',
    'mail.notification.reaction_detected.title':
      'We paused your routine for a moment',
    'mail.notification.reaction_detected.intro':
      'Hi {{firstName}}. Your latest photo shows some changes that were not there yesterday. We have paused your actives and switched you to barrier mode while your skin settles.',
    'mail.notification.reaction_detected.reassurance':
      'This is not a diagnosis. Just Ritora being cautious. Most reactions calm down in 2 to 4 days with gentler care.',
    'mail.notification.reaction_detected.pausedLabel': 'PAUSED FOR NOW',
    'mail.notification.reaction_detected.pausedTitle':
      '{{count}} actives held back from your routine',
    'mail.notification.reaction_detected.guidanceTitle':
      'For the next few days',
    'mail.notification.reaction_detected.guidanceBody':
      'Cleanser, moisturiser, SPF. That is it. Skip exfoliants, hot water, and anything new. Keep taking your photo as usual so we can see when you are ready to layer back in.',
    'mail.notification.reaction_detected.ctaLabel': 'View what changed',
    'mail.notification.reaction_detected.disclaimer':
      "If the reaction worsens, spreads, or comes with swelling or pain, please contact a dermatologist. Ritora's signal is supportive, not medical.",
    'mail.notification.reaction_detected.footerWhy':
      'You are getting this because reaction alerts are critical and stay on for everyone.',
    'mail.subject.simplification_started': 'Your routine is now simplified',
    'mail.notification.simplification_started.previewText':
      'Your routine has been streamlined to help your barrier recover.',
    'mail.notification.simplification_started.title':
      'Your routine is now simplified',
    'mail.notification.simplification_started.intro':
      'We have trimmed your routine to the essentials so your barrier can rest. The actives are still on your shelf. They will come back as soon as your skin is ready.',
    'mail.notification.simplification_started.routineLabel':
      'SIMPLIFIED ROUTINE · {{stepCount}} STEPS',
    'mail.notification.simplification_started.routineSummary': '{{flow}}',
    'mail.notification.simplification_started.ctaLabel':
      'View simplified routine',
    'mail.notification.simplification_started.recoveryNote':
      'Ritora will watch your photos and bring back actives one at a time once your skin shows it is ready. Usually 3 to 7 days.',
    'mail.notification.simplification_started.footerWhy':
      'You are getting this because simplification alerts are on.',
    'mail.notification.simplification_started.unsubscribeLabel':
      'Unsubscribe from simplification alerts',
    'mail.subject.insight_ready': 'A new insight about your skin',
    'mail.notification.insight_ready.previewText':
      'Your photos are telling a quiet story.',
    'mail.notification.insight_ready.title': 'A new insight, {{firstName}}',
    'mail.notification.insight_ready.intro':
      'After your recent days of photos and records, your skin is telling us something specific. Here is what we found.',
    'mail.notification.insight_ready.disclaimer':
      'Insights are not medical claims. They are patterns Ritora noticed in your own data. Open the inside view to see the methodology and the days behind the number.',
    'mail.notification.insight_ready.ctaLabel': 'Read full insight',
    'mail.notification.insight_ready.footerWhy':
      'You are getting this because insight alerts are on.',
    'mail.notification.insight_ready.unsubscribeLabel':
      'Unsubscribe from insight alerts',
    'mail.subject.doctor_referral': 'A specialist referral suggestion',
    'mail.notification.doctor_referral.previewText':
      'A pattern Ritora cannot fully read alone. A specialist could.',
    'mail.notification.doctor_referral.title':
      'Worth seeing a {{specialistType}}',
    'mail.notification.doctor_referral.intro':
      'Ritora has been watching a recurring pattern that does not respond to the usual barrier and rest routine. A specialist can look at it properly. This is a suggestion, not a diagnosis.',
    'mail.notification.doctor_referral.specialistLabel': 'SUGGESTED SPECIALIST',
    'mail.notification.doctor_referral.specialistTitle':
      '{{specialistType}} · {{consultMode}}',
    'mail.notification.doctor_referral.prepTitle': 'What to bring',
    'mail.notification.doctor_referral.prepBody':
      'Ritora can prepare a one page summary. Your shelf, your routine history, the photos around the pattern, and the timeline. The specialist gets context in 30 seconds, and you skip the "what have you tried" part.',
    'mail.notification.doctor_referral.ctaLabel': 'View suggestion + summary',
    'mail.notification.doctor_referral.disclaimer':
      'Ritora is not a medical service. We surface signals. Specialists make calls. If something feels urgent, like pain, swelling, or fever, do not wait for an appointment.',
    'mail.notification.doctor_referral.footerWhy':
      'You are getting this because referral suggestions are on.',
    'mail.notification.doctor_referral.unsubscribeLabel':
      'Unsubscribe from referral suggestions',
    'mail.subject.wrapped_ready': 'Your week in skin · Ritora',
    'mail.notification.wrapped_ready.previewText':
      'Your week in skin. Small wins, honest gaps, and one thing to try next.',
    'mail.notification.wrapped_ready.title': 'Your week in skin, {{firstName}}',
    'mail.notification.wrapped_ready.intro':
      'A small story this week. Here is the wrap.',
    'mail.notification.wrapped_ready.weekLabel': '{{weekRange}}',
    'mail.notification.wrapped_ready.ctaLabel': "Open this week's wrap",
    'mail.notification.wrapped_ready.footnote':
      'Inside the wrap, you will find your photos day by day, what you applied, the redness curve, and the rationale behind every suggestion change.',
    'mail.notification.wrapped_ready.footerWhy':
      'You are getting this because Wrapped is on.',
    'mail.notification.wrapped_ready.unsubscribeLabel':
      'Unsubscribe from Wrapped',
    'errors.internalServer': 'Internal server error',
    'errors.originNotAllowed': 'Origin not allowed',
    'errors.userNotFound': 'User not found',
    'errors.skinProfileUserNotVerified':
      'Verify your email before creating your skin profile',
    'errors.skinProfileAlreadyExists': 'Skin profile already exists',
    'errors.skinProfileNotFound': 'Skin profile not found',
    'errors.skinProfileCountryRequired':
      'Country code is required when a city is provided',
    'errors.inventory.brandRequired': 'Brand is required',
    'errors.inventory.nameRequired': 'Product name is required',
    'errors.inventory.descriptionRequired': 'Product description is required',
    'errors.inventory.benefitsRequired':
      'At least one product benefit is required',
    'errors.inventory.suitedForRequired':
      'At least one suited-for value is required',
    'errors.inventory.inciRequired': 'At least one INCI ingredient is required',
    'errors.inventory.guidanceRequired':
      'At least one guidance step is required',
    'errors.inventory.expiryBeforeOpened':
      'Expiry date cannot be earlier than opened date',
    'errors.inventory.notFound': 'Inventory product not found',
    'errors.schedule.slotConflict':
      'A slot already exists at that day and time',
    'errors.schedule.moveConflict':
      'A slot already exists at the destination day and time',
    'errors.schedule.tooManySteps': 'Cannot add more than 10 steps',
    'errors.schedule.customLabelRequired':
      'Custom step labels must include a name',
    'errors.schedule.productsNotOwned':
      'Some selected products are not on your shelf',
    'errors.schedule.requiresProduct':
      'Add at least one product before creating a schedule',
    'errors.schedule.slotNotFound': 'Slot not found',
    'errors.cursor.invalid': 'Invalid cursor',
    'errors.cursor.requestMismatch': 'Cursor does not match this request',
    'errors.cursor.missingItem': 'Cursor no longer points to a valid item',
    'errors.catalogue.invalidBarcode': 'Invalid barcode',
    'errors.url.safeExternal':
      '{{fieldName}} must be a safe external HTTP(S) URL',
    'errors.auth.termsRequired':
      'You must accept the terms of service and privacy policy',
    'errors.auth.emailInUse': 'Email already in use',
    'errors.auth.invalidCredentials': 'Invalid credentials',
    'errors.auth.emailNotVerified': 'Email not verified',
    'errors.auth.invalidRefreshToken': 'Invalid refresh token',
    'errors.auth.revokedRefreshToken':
      'Refresh token has been revoked — all sessions invalidated',
    'errors.auth.expiredRefreshToken': 'Refresh token expired',
    'errors.auth.invalidVerificationToken': 'Invalid verification token',
    'errors.auth.expiredVerificationToken': 'Verification token has expired',
    'errors.auth.invalidResetToken': 'Invalid reset token',
    'errors.auth.expiredResetToken': 'Reset token has expired',
    'errors.auth.invalidPassword': 'Invalid password',
    'errors.auth.noRefreshToken': 'No refresh token',
    'errors.auth.accountRestricted':
      'This account has been restricted. Contact support if you believe this is a mistake.',
    'validation.email.invalid': 'Enter a valid email address',
    'validation.email.maxLength':
      'Email address must be 255 characters or fewer',
    'validation.password.minLength':
      'Password must be at least 8 characters long',
    'validation.password.required': 'Enter your password',
    'validation.password.maxLength': 'Password must be 72 characters or fewer',
    'validation.password.strong':
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    'validation.reason.required': 'Enter an audit reason',
    'validation.reason.maxLength':
      'Audit reason must be 500 characters or fewer',
    'validation.token.hex64': 'Token must be a 64-character hexadecimal string',
    'validation.language.unsupported': 'Choose English or Swedish',
    'validation.name.required': 'This field is required',
    'validation.timeZone.unsupported': 'Choose a supported timezone',
  },
  sv: {
    'messages.auth.register.verifyEmail':
      'Verifiera din e-post för att aktivera ditt konto',
    'messages.auth.verifyEmail.success': 'E-postadressen har verifierats',
    'messages.auth.resendVerification.success':
      'Om e-postadressen är registrerad har en verifieringslänk skickats',
    'messages.auth.forgotPassword.success':
      'Om e-postadressen är registrerad har en återställningslänk skickats',
    'messages.auth.resetPassword.success': 'Lösenordet har återställts',
    'messages.adminAuth.forgotPassword.success':
      'Om e-postadressen är registrerad har en återställningslänk skickats',
    'messages.adminAuth.resetPassword.success': 'Lösenordet har återställts',
    'messages.auth.logout.success': 'Du har loggats ut',
    'messages.auth.logoutAll.success': 'Alla sessioner har avslutats',
    'messages.auth.deleteAccount.success': 'Kontot har raderats',
    'messages.auth.deleteAccount.scheduled':
      'Kontot är schemalagt för radering',
    'messages.auth.deleteAccount.confirmationRequired':
      'Kontrollera din e-post för att bekräfta radering av kontot',
    'messages.auth.deleteAccount.cancelled': 'Kontoraderingen har avbrutits',
    'mail.subject.verification': 'Verifiera ditt Ritora-konto',
    'mail.subject.passwordReset': 'Återställ ditt Ritora-lösenord',
    'mail.subject.adminInvitation': 'Du har bjudits in till Ritora Admin',
    'mail.subject.adminPasswordReset': 'Återställ ditt Ritora Admin-lösenord',
    'mail.subject.accountDeletionConfirm':
      'Bekräfta radering av ditt Ritora-konto',
    'mail.subject.accountDeletionScheduled':
      'Ditt Ritora-konto raderas den {{scheduledFor}}',
    'mail.subject.accountDeletionCancelled':
      'Goda nyheter, ditt Ritora-konto är kvar',
    'mail.verification.previewText':
      'Välkommen till Ritora. Tryck på knappen i mejlet för att verifiera din e-post och komma igång.',
    'mail.verification.title': 'Välkommen till Ritora, {{firstName}}',
    'mail.verification.intro':
      'Tryck på knappen nedan för att verifiera din e-post och slutföra din registrering.',
    'mail.verification.ctaLabel': 'Verifiera e-post',
    'mail.verification.expiry':
      'Länken fungerar i 24 timmar och kan bara användas en gång.',
    'mail.verification.fallbackIntro':
      'Om knappen inte öppnas kan du kopiera och klistra in länken i din webbläsare.',
    'mail.verification.ignore':
      'Om du inte skapade ett konto hos Ritora kan du ignorera det här mejlet. Ingenting händer med din adress.',
    'mail.verification.footerLineOne':
      'Skickat från Ritora. Vi hjälper dig att skapa en lugnare hudvårdsrutin utifrån produkterna du redan har.',
    'mail.verification.footerLineTwo':
      'Behöver du hjälp? Skriv till oss på support@getritora.com.',
    'mail.passwordReset.previewText':
      'Återställ ditt Ritora-lösenord. Den här länken fungerar i en timme.',
    'mail.passwordReset.title': 'Återställ ditt lösenord',
    'mail.passwordReset.intro':
      'Hej {{firstName}}, vi har fått en begäran om att återställa lösenordet till ditt Ritora-konto. Tryck på knappen nedan för att välja ett nytt.',
    'mail.passwordReset.ctaLabel': 'Välj ett nytt lösenord',
    'mail.passwordReset.expiry':
      'Länken fungerar i en timme och kan bara användas en gång.',
    'mail.passwordReset.fallbackIntro':
      'Om knappen inte öppnas kan du kopiera och klistra in länken i din webbläsare.',
    'mail.passwordReset.unexpectedTitle': 'Var det inte du?',
    'mail.passwordReset.unexpectedBody':
      'Du kan ignorera det här mejlet så fortsätter ditt nuvarande lösenord att fungera. Ritora kommer aldrig att be om ditt lösenord via e-post.',
    'mail.passwordReset.footerLine':
      'Skickat från Ritora. Om du har frågor om ditt konto finns vi på support@getritora.com.',
    'mail.adminInvitation.previewText':
      'Välj ett Ritora Admin-lösenord för att acceptera inbjudan.',
    'mail.adminInvitation.title': 'Acceptera din Ritora Admin-inbjudan',
    'mail.adminInvitation.intro':
      '{{invitedByName}} har bjudit in dig att hjälpa till att hantera Ritora. Välj ett lösenord för att acceptera inbjudan.',
    'mail.adminInvitation.ctaLabel': 'Välj adminlösenord',
    'mail.adminInvitation.expiry':
      'Inbjudan fungerar i 7 dagar och kan bara användas en gång.',
    'mail.adminInvitation.unexpectedTitle': 'Förväntade du dig inte detta?',
    'mail.adminInvitation.unexpectedBody':
      'Ignorera mejlet om du inte förväntade dig åtkomst. Ritora kommer aldrig att be om ditt lösenord via e-post.',
    'mail.adminInvitation.footerLine':
      'Skickat från Ritora för intern kontosäkerhet. Frågor? Skriv till support@getritora.com.',
    'mail.adminPasswordReset.previewText':
      'Återställ ditt Ritora Admin-lösenord. Länken fungerar i en timme.',
    'mail.adminPasswordReset.title': 'Återställ ditt adminlösenord',
    'mail.adminPasswordReset.intro':
      'Hej {{firstName}}, vi har fått en begäran om att återställa ditt Ritora Admin-lösenord.',
    'mail.adminPasswordReset.ctaLabel': 'Välj ett nytt lösenord',
    'mail.adminPasswordReset.footerLine':
      'Skickat från Ritora för intern kontosäkerhet. Frågor? Skriv till support@getritora.com.',
    'mail.accountDeletion.confirm.previewText':
      'Tryck för att bekräfta att du vill radera ditt Ritora-konto. Länken gäller i en timme.',
    'mail.accountDeletion.confirm.badgeLabel': 'Åtgärd krävs',
    'mail.accountDeletion.confirm.title':
      'Bekräfta kontoradering, {{firstName}}',
    'mail.accountDeletion.confirm.intro':
      'Vi har fått en begäran om att radera ditt Ritora-konto. Bekräfta bara om det var du. Länken gäller den närmaste timmen.',
    'mail.accountDeletion.confirm.ctaLabel': 'Bekräfta radering',
    'mail.accountDeletion.confirm.timelineTitle': 'Så här går det till',
    'mail.accountDeletion.confirm.timeline1Title': 'Du bekräftar',
    'mail.accountDeletion.confirm.timeline1Body':
      'Vi loggar ut alla enheter och startar din 30-dagarsfrist.',
    'mail.accountDeletion.confirm.timeline2Title': 'Närmaste 30 dagarna',
    'mail.accountDeletion.confirm.timeline2Body':
      'Ångra dig när som helst. Logga in igen eller använd avbryt-länken i mejlet.',
    'mail.accountDeletion.confirm.timeline3Title': 'Efter dag 30',
    'mail.accountDeletion.confirm.timeline3Body':
      'Din profil, dina bilder, hylla och historik raderas permanent.',
    'mail.accountDeletion.confirm.note':
      'Länken gäller i 1 timme och kan bara användas en gång.',
    'mail.accountDeletion.confirm.fallbackIntro':
      'Fungerar inte knappen? Kopiera och klistra in länken i din webbläsare.',
    'mail.accountDeletion.confirm.ignoreNote':
      'Var det inte du? Då kan du ignorera mejlet. Kontot är fortsatt aktivt och ingenting ändras.',
    'mail.accountDeletion.confirm.footerLine':
      'Skickat från Ritora för kontosäkerhet. Frågor? Skriv till support@getritora.com.',
    'mail.accountDeletion.scheduled.previewText':
      'Ditt Ritora-konto raderas permanent den {{scheduledFor}}. Avbryt när som helst innan dess.',
    'mail.accountDeletion.scheduled.badgeLabel':
      'Schemalagd · {{scheduledFor}}',
    'mail.accountDeletion.scheduled.title':
      'Ditt konto är schemalagt för radering',
    'mail.accountDeletion.scheduled.intro':
      'Hej {{firstName}}, ditt Ritora-konto är schemalagt att raderas permanent den {{scheduledFor}}. Du har 30 dagar att ångra dig.',
    'mail.accountDeletion.scheduled.ctaLabel': 'Avbryt radering',
    'mail.accountDeletion.scheduled.timelineTitle': 'Din 30-dagarsfrist',
    'mail.accountDeletion.scheduled.timeline1Title': 'Idag',
    'mail.accountDeletion.scheduled.timeline1Body':
      'Alla sessioner är utloggade. Din data sparas säkert och används inte.',
    'mail.accountDeletion.scheduled.timeline2Title':
      'När som helst före den {{scheduledFor}}',
    'mail.accountDeletion.scheduled.timeline2Body':
      'Tryck på "Avbryt radering" ovan, eller logga in igen för att behålla kontot.',
    'mail.accountDeletion.scheduled.timeline3Title': 'Den {{scheduledFor}}',
    'mail.accountDeletion.scheduled.timeline3Body':
      'Din profil, dina bilder, hylla och historik raderas permanent. Detta kan inte ångras.',
    'mail.accountDeletion.scheduled.note':
      'Var det inte du? Avbryt nu och återställ ditt lösenord. Ritora frågar aldrig efter ditt lösenord via e-post.',
    'mail.accountDeletion.scheduled.fallbackIntro':
      'Fungerar inte knappen? Kopiera och klistra in länken i din webbläsare.',
    'mail.accountDeletion.scheduled.footerLine':
      'Skickat från Ritora för kontosäkerhet. Behöver du hjälp? Skriv till support@getritora.com.',
    'mail.accountDeletion.cancelled.previewText':
      'Goda nyheter. Ditt Ritora-konto är kvar och ingenting har raderats.',
    'mail.accountDeletion.cancelled.badgeLabel': 'Avbruten',
    'mail.accountDeletion.cancelled.title': 'Välkommen tillbaka, {{firstName}}',
    'mail.accountDeletion.cancelled.intro':
      'Din raderingsbegäran är avbruten. Ditt Ritora-konto är aktivt och allting är precis där du lämnade det.',
    'mail.accountDeletion.cancelled.ctaLabel': 'Öppna Ritora',
    'mail.accountDeletion.cancelled.recapTitle': 'En snabb sammanfattning',
    'mail.accountDeletion.cancelled.recapItem1':
      'Din profil, dina bilder och rutinhistorik är trygga',
    'mail.accountDeletion.cancelled.recapItem2':
      'Din hylla, ditt schema och dina förslag är redo när du är',
    'mail.accountDeletion.cancelled.recapItem3':
      'Inget mer behöver göras. Logga in när som helst för att fortsätta',
    'mail.accountDeletion.cancelled.note':
      'Avbröt du inte själv? Återställ ditt lösenord och granska dina aktiva sessioner. Vi hjälper dig — skriv till support@getritora.com.',
    'mail.accountDeletion.cancelled.fallbackIntro':
      'Fungerar inte knappen? Kopiera och klistra in länken i din webbläsare.',
    'mail.accountDeletion.cancelled.footerLine':
      'Skickat från Ritora för kontosäkerhet. Frågor? Skriv till support@getritora.com.',
    'mail.notification.shared.manageLabel': 'Hantera aviseringar',
    'mail.notification.shared.supportLine': 'Behöver du hjälp? Skriv till',
    'mail.daypart.morning': 'morgon',
    'mail.daypart.noon': 'middag',
    'mail.daypart.evening': 'kväll',
    'mail.subject.photo_reminder': 'Lägg till dagens hudbild',
    'mail.notification.photo_reminder.previewText':
      'En kort bild idag håller din utveckling ärlig.',
    'mail.notification.photo_reminder.title':
      'Dags för dagens bild, {{firstName}}',
    'mail.notification.photo_reminder.intro':
      'En kort bild i jämnt ljus är allt din hud behöver av dig idag. Ritora läser den för reaktioner, följer hur det går och formar förslagen framåt.',
    'mail.notification.photo_reminder.payloadLabel': 'IDAG · {{date}}',
    'mail.notification.photo_reminder.payloadTitle': 'Ingen bild loggad än',
    'mail.notification.photo_reminder.payloadMeta':
      'Senaste bild: {{lastPhotoLabel}}',
    'mail.notification.photo_reminder.ctaLabel': 'Lägg till dagens bild',
    'mail.notification.photo_reminder.tipNote':
      'Samma fönster, samma ljus. Ritora jämför dina bilder över de senaste 14 dagarna för att fånga små förändringar du annars skulle missa.',
    'mail.notification.photo_reminder.footerWhy':
      'Du får det här mejlet eftersom dagliga bildpåminnelser är på.',
    'mail.notification.photo_reminder.unsubscribeLabel':
      'Avregistrera bildpåminnelser',
    'mail.subject.suggestion_ready': 'Din {{slot}}rutin är klar',
    'mail.notification.suggestion_ready.previewText':
      'Din rutin är formad och väntar på Idag-sidan.',
    'mail.notification.suggestion_ready.title': 'Din {{slot}}rutin är klar',
    'mail.notification.suggestion_ready.intro':
      'Anpassad efter din hud idag, vad du applicerade igår kväll och de ingredienser som redan finns på din hylla.',
    'mail.notification.suggestion_ready.slotLabel': '{{slot}} · {{slotTime}}',
    'mail.notification.suggestion_ready.stepSummary':
      '{{stepCount}} steg, ungefär {{minutes}} minuter',
    'mail.notification.suggestion_ready.ctaLabel': 'Öppna dagens plan',
    'mail.notification.suggestion_ready.rationale':
      'Varför just dessa. Ritora utelämnade allt som krockar med gårdagens aktiva ingredienser och höll din barriär lätt så att dagens SPF kan göra sitt jobb.',
    'mail.notification.suggestion_ready.footerWhy':
      'Du får det här eftersom rutinaviseringar är på.',
    'mail.notification.suggestion_ready.unsubscribeLabel':
      'Avregistrera rutinaviseringar',
    'mail.subject.slot_start': 'Dags för din {{slot}}rutin',
    'mail.notification.slot_start.previewText':
      'Din {{slot}}rutin är uppe och väntar.',
    'mail.notification.slot_start.title':
      'Det är dags, {{firstName}}. {{slot}}rutin.',
    'mail.notification.slot_start.intro':
      '{{minutes}} minuter, {{stepCount}} steg, sedan är dagen din. Vi puffar dig om 30 om du glömmer logga.',
    'mail.notification.slot_start.payloadLabel': 'PASS NU · {{slot}}',
    'mail.notification.slot_start.payloadTitle': '{{stepFlow}}',
    'mail.notification.slot_start.payloadMeta':
      'Ungefär {{minutes}} min. Snäll mot din barriär. Avslutar med SPF.',
    'mail.notification.slot_start.ctaLabel': 'Applicera nu',
    'mail.notification.slot_start.footerWhy':
      'Du får det här eftersom passstartaviseringar är på.',
    'mail.notification.slot_start.unsubscribeLabel':
      'Avregistrera passstartaviseringar',
    'mail.subject.recording_reminder': 'Snabb logg: applicerade du din rutin?',
    'mail.notification.recording_reminder.previewText':
      'Tio sekunder för att logga vad du faktiskt applicerade i {{slot}}.',
    'mail.notification.recording_reminder.title':
      'Applicerade du din {{slot}}rutin?',
    'mail.notification.recording_reminder.intro':
      'Tio sekunder är allt som krävs. Logga vad som faktiskt blev så vet nästa förslag var det ska börja.',
    'mail.notification.recording_reminder.slotLabel':
      '{{slot}}PASS · {{slotTime}}',
    'mail.notification.recording_reminder.statusLabel': 'Väntar på logg',
    'mail.notification.recording_reminder.stepsMeta':
      '{{stepCount}} föreslagna steg. Checklistan är redan ifylld. Ungefär 10 sekunder att bekräfta.',
    'mail.notification.recording_reminder.ctaLabel': 'Logga {{slot}} nu',
    'mail.notification.recording_reminder.skipNote':
      'Hoppade över idag? <a class="email-link email-secondary-link" href="{{skipUrl}}" style="color: #6b7361; text-decoration: underline;">Markera passet som hoppat</a>. Vi anpassar oss utan att tjata.',
    'mail.notification.recording_reminder.footerWhy':
      'Du får det här eftersom loggpåminnelser är på.',
    'mail.notification.recording_reminder.unsubscribeLabel':
      'Avregistrera loggpåminnelser',
    'mail.subject.reaction_detected': 'Din rutin har pausats',
    'mail.notification.reaction_detected.previewText':
      'Rutin pausad. Din barriär är prioriteten de närmaste dagarna.',
    'mail.notification.reaction_detected.title':
      'Vi pausade din rutin för en stund',
    'mail.notification.reaction_detected.intro':
      'Hej {{firstName}}. Din senaste bild visar förändringar som inte fanns igår. Vi har pausat dina aktiva ingredienser och växlat till barriärläge medan din hud lugnar sig.',
    'mail.notification.reaction_detected.reassurance':
      'Det här är ingen diagnos. Bara Ritora som är försiktig. De flesta reaktioner lägger sig på 2 till 4 dagar med mildare vård.',
    'mail.notification.reaction_detected.pausedLabel': 'PAUSADE JUST NU',
    'mail.notification.reaction_detected.pausedTitle':
      '{{count}} aktiva ingredienser hålls tillbaka från din rutin',
    'mail.notification.reaction_detected.guidanceTitle': 'De närmaste dagarna',
    'mail.notification.reaction_detected.guidanceBody':
      'Rengöring, kräm, SPF. Det är allt. Hoppa över peeling, hett vatten och allt nytt. Ta din bild som vanligt så vi ser när du är redo att lägga tillbaka steg.',
    'mail.notification.reaction_detected.ctaLabel': 'Se vad som ändrats',
    'mail.notification.reaction_detected.disclaimer':
      'Om reaktionen förvärras, sprider sig eller kommer med svullnad eller smärta, kontakta en hudläkare. Ritoras signal är stödjande, inte medicinsk.',
    'mail.notification.reaction_detected.footerWhy':
      'Du får det här eftersom reaktionsaviseringar är kritiska och alltid på.',
    'mail.subject.simplification_started': 'Din rutin är nu förenklad',
    'mail.notification.simplification_started.previewText':
      'Din rutin har strömlinjeformats för att hjälpa din barriär att återhämta sig.',
    'mail.notification.simplification_started.title':
      'Din rutin är nu förenklad',
    'mail.notification.simplification_started.intro':
      'Vi har trimmat din rutin till det väsentliga så att din barriär kan vila. De aktiva ingredienserna är fortfarande på din hylla. De kommer tillbaka så snart din hud är redo.',
    'mail.notification.simplification_started.routineLabel':
      'FÖRENKLAD RUTIN · {{stepCount}} STEG',
    'mail.notification.simplification_started.routineSummary': '{{flow}}',
    'mail.notification.simplification_started.ctaLabel': 'Visa förenklad rutin',
    'mail.notification.simplification_started.recoveryNote':
      'Ritora följer dina bilder och tar tillbaka aktiva ingredienser en i taget när din hud visar att den är redo. Vanligtvis 3 till 7 dagar.',
    'mail.notification.simplification_started.footerWhy':
      'Du får det här eftersom förenklingsaviseringar är på.',
    'mail.notification.simplification_started.unsubscribeLabel':
      'Avregistrera förenklingsaviseringar',
    'mail.subject.insight_ready': 'En ny insikt om din hud',
    'mail.notification.insight_ready.previewText':
      'Dina bilder berättar en stilla historia.',
    'mail.notification.insight_ready.title': 'En ny insikt, {{firstName}}',
    'mail.notification.insight_ready.intro':
      'Efter dina senaste dagar med bilder och loggar berättar din hud något specifikt. Här är vad vi hittade.',
    'mail.notification.insight_ready.disclaimer':
      'Insikter är inte medicinska påståenden. Det är mönster Ritora hittat i din egen data. Öppna insidan för att se metoden och dagarna bakom siffran.',
    'mail.notification.insight_ready.ctaLabel': 'Läs hela insikten',
    'mail.notification.insight_ready.footerWhy':
      'Du får det här eftersom insiktsaviseringar är på.',
    'mail.notification.insight_ready.unsubscribeLabel':
      'Avregistrera insiktsaviseringar',
    'mail.subject.doctor_referral': 'Förslag på remiss till specialist',
    'mail.notification.doctor_referral.previewText':
      'Ett mönster Ritora inte kan läsa fullt ut själv. En specialist kan.',
    'mail.notification.doctor_referral.title':
      'Värt att träffa en {{specialistType}}',
    'mail.notification.doctor_referral.intro':
      'Ritora har följt ett återkommande mönster som inte svarar på den vanliga barriär och vila rutinen. En specialist kan se på det ordentligt. Det här är ett förslag, inte en diagnos.',
    'mail.notification.doctor_referral.specialistLabel':
      'FÖRESLAGEN SPECIALIST',
    'mail.notification.doctor_referral.specialistTitle':
      '{{specialistType}} · {{consultMode}}',
    'mail.notification.doctor_referral.prepTitle': 'Det du tar med dig',
    'mail.notification.doctor_referral.prepBody':
      'Ritora kan förbereda en sammanfattning på en sida. Din hylla, din rutinhistorik, bilderna kring mönstret och tidslinjen. Specialisten får sammanhang på 30 sekunder, och du slipper berätta vad du redan provat.',
    'mail.notification.doctor_referral.ctaLabel':
      'Visa förslag + sammanfattning',
    'mail.notification.doctor_referral.disclaimer':
      'Ritora är ingen medicinsk tjänst. Vi lyfter signaler. Specialister fattar besluten. Om något känns akut, som smärta, svullnad eller feber, vänta inte på en tid.',
    'mail.notification.doctor_referral.footerWhy':
      'Du får det här eftersom remissförslag är på.',
    'mail.notification.doctor_referral.unsubscribeLabel':
      'Avregistrera remissförslag',
    'mail.subject.wrapped_ready': 'Din vecka i hud · Ritora',
    'mail.notification.wrapped_ready.previewText':
      'Din vecka i hud. Små vinster, ärliga luckor och en sak att prova härnäst.',
    'mail.notification.wrapped_ready.title': 'Din vecka i hud, {{firstName}}',
    'mail.notification.wrapped_ready.intro':
      'En liten historia den här veckan. Här är sammanfattningen.',
    'mail.notification.wrapped_ready.weekLabel': '{{weekRange}}',
    'mail.notification.wrapped_ready.ctaLabel': 'Öppna veckans sammanfattning',
    'mail.notification.wrapped_ready.footnote':
      'Inuti sammanfattningen finns dina bilder dag för dag, vad du applicerade, rodnadskurvan och resonemanget bakom varje förslagsändring.',
    'mail.notification.wrapped_ready.footerWhy':
      'Du får det här eftersom Wrapped är på.',
    'mail.notification.wrapped_ready.unsubscribeLabel': 'Avregistrera Wrapped',
    'errors.internalServer': 'Internt serverfel',
    'errors.originNotAllowed': 'Otillåten origin',
    'errors.userNotFound': 'Användaren hittades inte',
    'errors.skinProfileUserNotVerified':
      'Verifiera din e-post innan du skapar din hudprofil',
    'errors.skinProfileAlreadyExists': 'Hudprofil finns redan',
    'errors.skinProfileNotFound': 'Hudprofilen hittades inte',
    'errors.skinProfileCountryRequired': 'Landskod krävs när en stad anges',
    'errors.inventory.brandRequired': 'Varumärke krävs',
    'errors.inventory.nameRequired': 'Produktnamn krävs',
    'errors.inventory.descriptionRequired': 'Produktbeskrivning krävs',
    'errors.inventory.benefitsRequired': 'Minst en produktfördel krävs',
    'errors.inventory.suitedForRequired':
      'Minst ett värde för passar för krävs',
    'errors.inventory.inciRequired': 'Minst en INCI-ingrediens krävs',
    'errors.inventory.guidanceRequired': 'Minst ett användningssteg krävs',
    'errors.inventory.expiryBeforeOpened':
      'Utgångsdatum kan inte vara tidigare än öppningsdatum',
    'errors.inventory.notFound': 'Lagerprodukten hittades inte',
    'errors.schedule.slotConflict':
      'En tid finns redan för den dagen och tiden',
    'errors.schedule.moveConflict': 'En tid finns redan på målplatsen',
    'errors.schedule.tooManySteps': 'Du kan inte lägga till fler än 10 steg',
    'errors.schedule.customLabelRequired': 'Anpassade steg måste ha ett namn',
    'errors.schedule.productsNotOwned':
      'Några valda produkter finns inte på din hylla',
    'errors.schedule.requiresProduct':
      'Lägg till minst en produkt innan du skapar ett schema',
    'errors.schedule.slotNotFound': 'Tiden hittades inte',
    'errors.cursor.invalid': 'Ogiltig markör',
    'errors.cursor.requestMismatch': 'Markören matchar inte den här förfrågan',
    'errors.cursor.missingItem':
      'Markören pekar inte längre på ett giltigt objekt',
    'errors.catalogue.invalidBarcode': 'Ogiltig streckkod',
    'errors.url.safeExternal':
      '{{fieldName}} måste vara en säker extern HTTP(S)-URL',
    'errors.auth.termsRequired':
      'Du måste acceptera användarvillkoren och integritetspolicyn',
    'errors.auth.emailInUse': 'E-postadressen används redan',
    'errors.auth.invalidCredentials': 'Ogiltiga inloggningsuppgifter',
    'errors.auth.emailNotVerified': 'E-postadressen är inte verifierad',
    'errors.auth.invalidRefreshToken': 'Ogiltig uppdateringstoken',
    'errors.auth.revokedRefreshToken':
      'Uppdateringstoken har återkallats — alla sessioner har ogiltigförklarats',
    'errors.auth.expiredRefreshToken': 'Uppdateringstoken har gått ut',
    'errors.auth.invalidVerificationToken': 'Ogiltig verifieringstoken',
    'errors.auth.expiredVerificationToken': 'Verifieringstoken har gått ut',
    'errors.auth.invalidResetToken': 'Ogiltig återställningstoken',
    'errors.auth.expiredResetToken': 'Återställningstoken har gått ut',
    'errors.auth.invalidPassword': 'Ogiltigt lösenord',
    'errors.auth.noRefreshToken': 'Ingen uppdateringstoken hittades',
    'errors.auth.accountRestricted':
      'Det här kontot har begränsats. Kontakta support om du tror att detta är ett misstag.',
    'validation.email.invalid': 'Ange en giltig e-postadress',
    'validation.email.maxLength': 'E-postadressen får vara högst 255 tecken',
    'validation.password.minLength':
      'Lösenordet måste vara minst 8 tecken långt',
    'validation.password.required': 'Ange ditt lösenord',
    'validation.password.maxLength':
      'Lösenordet får vara högst 72 tecken långt',
    'validation.password.strong':
      'Lösenordet måste innehålla minst en versal, en gemen och en siffra',
    'validation.reason.required': 'Ange en granskningsorsak',
    'validation.reason.maxLength':
      'Granskningsorsaken får vara högst 500 tecken',
    'validation.token.hex64':
      'Token måste vara en hexadecimal sträng med 64 tecken',
    'validation.language.unsupported': 'Välj engelska eller svenska',
    'validation.name.required': 'Det här fältet är obligatoriskt',
    'validation.timeZone.unsupported': 'Välj en giltig tidszon',
  },
};

const codeKeyMap: Record<string, string> = {
  ACCOUNT_RESTRICTED: 'errors.auth.accountRestricted',
  EMAIL_NOT_VERIFIED: 'errors.auth.emailNotVerified',
  SCHEDULE_CUSTOM_LABEL_REQUIRED: 'errors.schedule.customLabelRequired',
  SCHEDULE_MOVE_CONFLICT: 'errors.schedule.moveConflict',
  SCHEDULE_PRODUCTS_NOT_OWNED: 'errors.schedule.productsNotOwned',
  SCHEDULE_REQUIRES_PRODUCT: 'errors.schedule.requiresProduct',
  SCHEDULE_SLOT_CONFLICT: 'errors.schedule.slotConflict',
  SCHEDULE_SLOT_NOT_FOUND: 'errors.schedule.slotNotFound',
  SCHEDULE_TOO_MANY_STEPS: 'errors.schedule.tooManySteps',
};

const messageKeyMap: Record<string, string> = {
  'Internal server error': 'errors.internalServer',
  'Origin not allowed': 'errors.originNotAllowed',
  'User not found': 'errors.userNotFound',
  'Verify your email before creating your skin profile':
    'errors.skinProfileUserNotVerified',
  'Skin profile already exists': 'errors.skinProfileAlreadyExists',
  'Skin profile not found': 'errors.skinProfileNotFound',
  'Country code is required when a city is provided':
    'errors.skinProfileCountryRequired',
  'Brand is required': 'errors.inventory.brandRequired',
  'Product name is required': 'errors.inventory.nameRequired',
  'Product description is required': 'errors.inventory.descriptionRequired',
  'At least one product benefit is required':
    'errors.inventory.benefitsRequired',
  'At least one suited-for value is required':
    'errors.inventory.suitedForRequired',
  'At least one INCI ingredient is required': 'errors.inventory.inciRequired',
  'At least one guidance step is required': 'errors.inventory.guidanceRequired',
  'Expiry date cannot be earlier than opened date':
    'errors.inventory.expiryBeforeOpened',
  'Inventory product not found': 'errors.inventory.notFound',
  'Invalid cursor': 'errors.cursor.invalid',
  'Cursor does not match this request': 'errors.cursor.requestMismatch',
  'Cursor no longer points to a valid item': 'errors.cursor.missingItem',
  'Invalid barcode': 'errors.catalogue.invalidBarcode',
  'You must accept the terms of service and privacy policy':
    'errors.auth.termsRequired',
  'Email already in use': 'errors.auth.emailInUse',
  'Invalid credentials': 'errors.auth.invalidCredentials',
  'Email not verified': 'errors.auth.emailNotVerified',
  'Invalid refresh token': 'errors.auth.invalidRefreshToken',
  'Refresh token has been revoked — all sessions invalidated':
    'errors.auth.revokedRefreshToken',
  'Refresh token expired': 'errors.auth.expiredRefreshToken',
  'Invalid verification token': 'errors.auth.invalidVerificationToken',
  'Verification token has expired': 'errors.auth.expiredVerificationToken',
  'Invalid reset token': 'errors.auth.invalidResetToken',
  'Reset token has expired': 'errors.auth.expiredResetToken',
  'Invalid password': 'errors.auth.invalidPassword',
  'No refresh token': 'errors.auth.noRefreshToken',
  'validation.email.invalid': 'validation.email.invalid',
  'validation.email.maxLength': 'validation.email.maxLength',
  'validation.password.minLength': 'validation.password.minLength',
  'validation.password.required': 'validation.password.required',
  'validation.password.maxLength': 'validation.password.maxLength',
  'validation.password.strong': 'validation.password.strong',
  'validation.reason.required': 'validation.reason.required',
  'validation.reason.maxLength': 'validation.reason.maxLength',
  'validation.token.hex64': 'validation.token.hex64',
  'validation.language.unsupported': 'validation.language.unsupported',
  'validation.name.required': 'validation.name.required',
  'validation.timeZone.unsupported': 'validation.timeZone.unsupported',
  'email must be an email': 'validation.email.invalid',
};

function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

export function normalizeLanguage(
  value: string | null | undefined,
): AppLanguage {
  if (!value) {
    return DEFAULT_LANGUAGE;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'sv' ? 'sv' : 'en';
}

function readHeaderValue(header: string | string[] | undefined): string | null {
  if (Array.isArray(header)) {
    return header[0] ?? null;
  }

  return typeof header === 'string' ? header : null;
}

export function resolveRequestLanguage(request: Request): AppLanguage {
  const requestWithUser = request as RequestWithLanguageUser;
  const requestUser =
    typeof requestWithUser.user === 'object' && requestWithUser.user !== null
      ? requestWithUser.user
      : null;
  const requestBody = request.body as Record<string, unknown> | undefined;
  const requestQuery = request.query as Record<string, unknown> | undefined;
  const acceptLanguage = readHeaderValue(request.headers['accept-language']);

  if (acceptLanguage?.toLowerCase().startsWith('sv')) {
    return 'sv';
  }

  const preferredLanguage =
    (typeof requestUser?.language === 'string' ? requestUser.language : null) ??
    (typeof requestUser?.preferred_language === 'string'
      ? requestUser.preferred_language
      : null) ??
    (typeof requestBody?.preferredLanguage === 'string'
      ? requestBody.preferredLanguage
      : null) ??
    (typeof requestBody?.language === 'string' ? requestBody.language : null) ??
    (typeof requestQuery?.language === 'string' ? requestQuery.language : null);

  if (preferredLanguage) {
    return normalizeLanguage(preferredLanguage);
  }

  return DEFAULT_LANGUAGE;
}

export function translate(
  language: AppLanguage,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const template =
    translations[language][key] ?? translations[DEFAULT_LANGUAGE][key] ?? key;

  return interpolate(template, values);
}

export function translateErrorMessage(
  language: AppLanguage,
  message: string,
  code?: string,
): string {
  const codeKey = code ? codeKeyMap[code] : undefined;
  if (codeKey) {
    return translate(language, codeKey);
  }

  const privateUrlMatch = message.match(
    /^(.*) must be a safe external HTTP\(S\) URL$/,
  );
  if (privateUrlMatch) {
    return translate(language, 'errors.url.safeExternal', {
      fieldName: privateUrlMatch[1],
    });
  }

  const key = messageKeyMap[message];
  if (!key) {
    return message;
  }

  return translate(language, key);
}
