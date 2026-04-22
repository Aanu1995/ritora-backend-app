import type { Request } from 'express';

export const SUPPORTED_LANGUAGES = ['en', 'sv'] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: AppLanguage = 'en';

type TranslationDictionary = Record<string, string>;

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
    'messages.auth.logout.success': 'Logged out',
    'messages.auth.logoutAll.success': 'All sessions revoked',
    'messages.auth.deleteAccount.success': 'Account deleted',
    'mail.subject.verification': 'Verify your Ritora account',
    'mail.subject.passwordReset': 'Reset your Ritora password',
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
    'validation.email.invalid': 'Enter a valid email address',
    'validation.password.minLength':
      'Password must be at least 8 characters long',
    'validation.password.strong':
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
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
    'messages.auth.logout.success': 'Du har loggats ut',
    'messages.auth.logoutAll.success': 'Alla sessioner har avslutats',
    'messages.auth.deleteAccount.success': 'Kontot har raderats',
    'mail.subject.verification': 'Verifiera ditt Ritora-konto',
    'mail.subject.passwordReset': 'Återställ ditt Ritora-lösenord',
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
    'validation.email.invalid': 'Ange en giltig e-postadress',
    'validation.password.minLength':
      'Lösenordet måste vara minst 8 tecken långt',
    'validation.password.strong':
      'Lösenordet måste innehålla minst en versal, en gemen och en siffra',
    'validation.token.hex64':
      'Token måste vara en hexadecimal sträng med 64 tecken',
    'validation.language.unsupported': 'Välj engelska eller svenska',
    'validation.name.required': 'Det här fältet är obligatoriskt',
    'validation.timeZone.unsupported': 'Välj en giltig tidszon',
  },
};

const codeKeyMap: Record<string, string> = {
  EMAIL_NOT_VERIFIED: 'errors.auth.emailNotVerified',
  SCHEDULE_CUSTOM_LABEL_REQUIRED: 'errors.schedule.customLabelRequired',
  SCHEDULE_MOVE_CONFLICT: 'errors.schedule.moveConflict',
  SCHEDULE_PRODUCTS_NOT_OWNED: 'errors.schedule.productsNotOwned',
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
  'validation.password.minLength': 'validation.password.minLength',
  'validation.password.strong': 'validation.password.strong',
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
  const requestUser = request.user as { language?: string | null } | undefined;
  const requestBody = request.body as Record<string, unknown> | undefined;
  const requestQuery = request.query as Record<string, unknown> | undefined;
  const acceptLanguage = readHeaderValue(request.headers['accept-language']);

  if (acceptLanguage?.toLowerCase().startsWith('sv')) {
    return 'sv';
  }

  const preferredLanguage =
    requestUser?.language ??
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
