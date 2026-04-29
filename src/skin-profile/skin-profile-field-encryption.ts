import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import type { ValueTransformer } from 'typeorm';
import type {
  HormonalContext,
  SafetyContext,
} from './entities/skin-profile.entity';

const ENCRYPTED_JSON_MARKER = '__ritora_encrypted';
const ENCRYPTED_STRING_PREFIX = 'ritora:v1:';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const DEV_ENCRYPTION_KEY =
  'ritora-dev-skin-profile-field-encryption-key-change-me';

type EncryptedJsonEnvelope = {
  [ENCRYPTED_JSON_MARKER]: true;
  v: 1;
  alg: typeof ENCRYPTION_ALGORITHM;
  kid: string;
  iv: string;
  tag: string;
  data: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEncryptedJsonEnvelope(
  value: unknown,
): value is EncryptedJsonEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value[ENCRYPTED_JSON_MARKER] === true &&
    value.v === 1 &&
    value.alg === ENCRYPTION_ALGORITHM &&
    typeof value.kid === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.data === 'string'
  );
}

function encryptionKeyId(): string {
  return process.env.SKIN_PROFILE_FIELD_ENCRYPTION_KEY_ID?.trim() || 'primary';
}

function encryptionKey(): Buffer {
  const configuredKey = process.env.SKIN_PROFILE_FIELD_ENCRYPTION_KEY?.trim();

  if (!configuredKey && process.env.NODE_ENV === 'production') {
    throw new Error('SKIN_PROFILE_FIELD_ENCRYPTION_KEY is required');
  }

  return createHash('sha256')
    .update(configuredKey || DEV_ENCRYPTION_KEY)
    .digest();
}

function aadFor(field: string, kid: string): Buffer {
  return Buffer.from(`ritora:skin-profile:${field}:v1:${kid}`, 'utf8');
}

function encryptPlaintext(
  plaintext: string,
  field: string,
): EncryptedJsonEnvelope {
  const kid = encryptionKeyId();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(aadFor(field, kid));

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    [ENCRYPTED_JSON_MARKER]: true,
    v: 1,
    alg: ENCRYPTION_ALGORITHM,
    kid,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  };
}

function decryptEnvelope(
  envelope: EncryptedJsonEnvelope,
  field: string,
): string {
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    encryptionKey(),
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAAD(aadFor(field, envelope.kid));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptedJsonFieldTransformer<T>(
  field: string,
  emptyValue: T,
): ValueTransformer {
  return {
    to(value: T | EncryptedJsonEnvelope | null | undefined) {
      if (isEncryptedJsonEnvelope(value)) {
        return value;
      }

      return encryptPlaintext(JSON.stringify(value ?? emptyValue), field);
    },
    from(value: unknown): T {
      if (value === null || value === undefined) {
        return emptyValue;
      }

      if (!isEncryptedJsonEnvelope(value)) {
        throw new Error(`Unencrypted skin profile JSON field ${field}`);
      }

      return JSON.parse(decryptEnvelope(value, field)) as T;
    },
  };
}

function encodeEncryptedString(envelope: EncryptedJsonEnvelope): string {
  return `${ENCRYPTED_STRING_PREFIX}${envelope.kid}:${envelope.iv}:${envelope.tag}:${envelope.data}`;
}

function decodeEncryptedString(value: string): EncryptedJsonEnvelope | null {
  if (!value.startsWith(ENCRYPTED_STRING_PREFIX)) {
    return null;
  }

  const parts = value.split(':');
  const [kid, iv, tag, data] =
    parts[2] === '' ? parts.slice(3) : parts.slice(2);
  if (!kid || !iv || !tag || !data) {
    return null;
  }

  return {
    [ENCRYPTED_JSON_MARKER]: true,
    v: 1,
    alg: ENCRYPTION_ALGORITHM,
    kid,
    iv,
    tag,
    data,
  };
}

export function encryptedNullableStringFieldTransformer(
  field: string,
): ValueTransformer {
  return {
    to(value: string | null | undefined) {
      if (value === null || value === undefined || value === '') {
        return value ?? null;
      }

      if (decodeEncryptedString(value)) {
        return value;
      }

      return encodeEncryptedString(encryptPlaintext(value, field));
    },
    from(value: unknown): string | null {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value !== 'string') {
        return null;
      }

      const envelope = decodeEncryptedString(value);
      if (!envelope) {
        throw new Error(`Unencrypted skin profile string field ${field}`);
      }

      return decryptEnvelope(envelope, field);
    },
  };
}

export function encryptedBooleanFieldTransformer(
  field: string,
  defaultValue: boolean,
): ValueTransformer {
  return {
    to(value: boolean | string | null | undefined) {
      if (typeof value === 'string' && decodeEncryptedString(value)) {
        return value;
      }

      const resolvedValue =
        typeof value === 'string' ? value === 'true' : (value ?? defaultValue);

      return encodeEncryptedString(
        encryptPlaintext(String(resolvedValue), field),
      );
    },
    from(value: unknown): boolean {
      if (typeof value === 'boolean') {
        return value;
      }

      if (typeof value !== 'string') {
        return defaultValue;
      }

      const envelope = decodeEncryptedString(value);
      if (!envelope) {
        throw new Error(`Unencrypted skin profile boolean field ${field}`);
      }

      return decryptEnvelope(envelope, field) === 'true';
    },
  };
}

export const encryptedNullableStringTransformer =
  encryptedNullableStringFieldTransformer('string');

export const encryptedSafetyContextTransformer =
  encryptedJsonFieldTransformer<SafetyContext>('safety-context', {});

export const encryptedHormonalContextTransformer =
  encryptedJsonFieldTransformer<HormonalContext>('hormonal-context', {});
