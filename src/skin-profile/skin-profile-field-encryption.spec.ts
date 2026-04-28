import {
  encryptedBooleanFieldTransformer,
  encryptedHormonalContextTransformer,
  encryptedJsonFieldTransformer,
  encryptedNullableStringTransformer,
  encryptedNullableStringFieldTransformer,
  encryptedSafetyContextTransformer,
} from './skin-profile-field-encryption';

describe('skin profile field encryption', () => {
  beforeEach(() => {
    process.env.SKIN_PROFILE_FIELD_ENCRYPTION_KEY = 'test-key'.repeat(8);
    process.env.SKIN_PROFILE_FIELD_ENCRYPTION_KEY_ID = 'test';
  });

  afterEach(() => {
    delete process.env.SKIN_PROFILE_FIELD_ENCRYPTION_KEY;
    delete process.env.SKIN_PROFILE_FIELD_ENCRYPTION_KEY_ID;
  });

  it('encrypts and decrypts safety context json fields', () => {
    const value = {
      conditions: ['eczema'],
      medications: ['topical_retinoid'],
    };

    const stored = encryptedSafetyContextTransformer.to(value);

    expect(stored).toMatchObject({ __ritora_encrypted: true });
    expect(stored).not.toMatchObject(value);
    expect(encryptedSafetyContextTransformer.from(stored)).toEqual(value);
  });

  it('encrypts and decrypts hormonal context json fields', () => {
    const value = {
      cycle_pattern: 'regular',
      cycle_related_breakouts: true,
    };

    const stored = encryptedHormonalContextTransformer.to(value);

    expect(stored).toMatchObject({ __ritora_encrypted: true });
    expect(encryptedHormonalContextTransformer.from(stored)).toEqual(value);
  });

  it('encrypts and decrypts nullable string fields', () => {
    const stored = encryptedNullableStringTransformer.to('pregnant');

    expect(typeof stored).toBe('string');
    expect(stored).not.toBe('pregnant');
    expect(encryptedNullableStringTransformer.from(stored)).toBe('pregnant');
  });

  it('encrypts empty json values so defaults do not remain plaintext', () => {
    const transformer = encryptedJsonFieldTransformer<Record<string, unknown>>(
      'skin_profiles.test_context',
      {},
    );

    const stored = transformer.to({});

    expect(stored).toMatchObject({ __ritora_encrypted: true });
    expect(transformer.from(stored)).toEqual({});
  });

  it('encrypts and decrypts json array fields', () => {
    const transformer = encryptedJsonFieldTransformer<string[]>(
      'skin_profiles.current_concerns',
      [],
    );

    const stored = transformer.to(['acne', 'dryness']);

    expect(stored).toMatchObject({ __ritora_encrypted: true });
    expect(transformer.from(stored)).toEqual(['acne', 'dryness']);
  });

  it('encrypts and decrypts boolean fields', () => {
    const transformer = encryptedBooleanFieldTransformer(
      'skin_profiles.allow_smart_picks',
      true,
    );

    const stored = transformer.to(false);

    expect(typeof stored).toBe('string');
    expect(stored).not.toBe('false');
    expect(transformer.from(stored)).toBe(false);
  });

  it('can read legacy encrypted string fields during migration', () => {
    const stored = encryptedNullableStringTransformer.to('not_pregnant');
    const transformer = encryptedNullableStringFieldTransformer(
      'skin_profiles.pregnancy_status',
      ['string'],
    );

    expect(transformer.from(stored)).toBe('not_pregnant');
  });

  it('can read legacy encrypted json fields during migration', () => {
    const stored = encryptedSafetyContextTransformer.to({
      conditions: ['eczema'],
    });
    const transformer = encryptedJsonFieldTransformer<Record<string, unknown>>(
      'skin_profiles.safety_context',
      {},
      ['safety-context'],
    );

    expect(transformer.from(stored)).toEqual({ conditions: ['eczema'] });
  });

  it('keeps existing plaintext values readable for migration safety', () => {
    expect(
      encryptedSafetyContextTransformer.from({ conditions: ['eczema'] }),
    ).toEqual({ conditions: ['eczema'] });
    expect(encryptedNullableStringTransformer.from('not_pregnant')).toBe(
      'not_pregnant',
    );
  });
});
