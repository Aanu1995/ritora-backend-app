import type { ValidationError } from 'class-validator';
import { buildValidationExceptionPayload } from './validation-exception';

describe('buildValidationExceptionPayload', () => {
  it('captures flattened field paths and message arrays', () => {
    const errors: ValidationError[] = [
      {
        property: 'email',
        constraints: {
          isEmail: 'validation.email.invalid',
        },
        children: [],
      } as ValidationError,
      {
        property: 'profile',
        constraints: undefined,
        children: [
          {
            property: 'timeZone',
            constraints: {
              maxLength: 'validation.timeZone.unsupported',
            },
            children: [],
          } as ValidationError,
        ],
      } as ValidationError,
    ];

    expect(buildValidationExceptionPayload(errors)).toEqual({
      statusCode: 400,
      message: ['validation.email.invalid', 'validation.timeZone.unsupported'],
      fieldErrors: {
        email: ['validation.email.invalid'],
        'profile.timeZone': ['validation.timeZone.unsupported'],
      },
    });
  });
});
