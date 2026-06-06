import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GoogleMobileAuthDto } from './google-mobile-auth.dto';

const validationOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

describe('GoogleMobileAuthDto', () => {
  it('accepts the localized mobile Google payload sent by the app', async () => {
    const dto = plainToInstance(GoogleMobileAuthDto, {
      idToken: 'google-id-token',
      preferredLanguage: 'sv',
      language: 'sv',
      termsAccepted: true,
      privacyPolicyAccepted: true,
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
  });

  it('rejects unsupported preferred languages', async () => {
    const dto = plainToInstance(GoogleMobileAuthDto, {
      idToken: 'google-id-token',
      preferredLanguage: 'fr',
      termsAccepted: true,
      privacyPolicyAccepted: true,
    });

    const errors = await validate(dto, validationOptions);

    expect(errors.map((error) => error.property)).toContain(
      'preferredLanguage',
    );
  });
});
