import { canonicalizeEmailForIdentity } from './users.service.utils';

describe('users service utils', () => {
  describe('canonicalizeEmailForIdentity', () => {
    it('removes plus-address aliases for custom domains', () => {
      expect(
        canonicalizeEmailForIdentity('  Jane.Doe+Promo@Example.COM  '),
      ).toBe('jane.doe@example.com');
    });

    it('removes Gmail dots and plus-address aliases', () => {
      expect(canonicalizeEmailForIdentity('John.Doe+Promo@Gmail.COM')).toBe(
        'johndoe@gmail.com',
      );
    });

    it('treats googlemail.com as the same Gmail identity namespace', () => {
      expect(canonicalizeEmailForIdentity('john.doe@googlemail.com')).toBe(
        'johndoe@gmail.com',
      );
    });

    it('preserves dots for non-Gmail domains', () => {
      expect(canonicalizeEmailForIdentity('jane.doe@example.com')).toBe(
        'jane.doe@example.com',
      );
    });
  });
});
