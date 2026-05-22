import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const RECOVERY_CODE_BYTES = 10;
const RECOVERY_CODE_GROUP_SIZE = 4;
const RECOVERY_CODE_COUNT = 10;

export type TotpVerificationResult = {
  code: string;
  timeStep: number;
};

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function formatTotpSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

export function buildTotpUri(input: { email: string; secret: string }): string {
  const issuer = 'Ritora Admin';
  const label = `${issuer}:${input.email}`;
  const params = new URLSearchParams({
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    issuer,
    period: String(TOTP_PERIOD_SECONDS),
    secret: input.secret,
  });

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function generateTotpCode(
  secret: string,
  timeStep: number = getTotpTimeStep(new Date()),
): string {
  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep), 0);
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function verifyTotpCode(
  secret: string,
  code: string,
  now = new Date(),
): TotpVerificationResult | null {
  const normalized = normalizeTotpCode(code);
  if (!normalized) {
    return null;
  }

  const currentStep = getTotpTimeStep(now);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const timeStep = currentStep + offset;
    const expected = generateTotpCode(secret, timeStep);
    if (timingSafeStringEqual(expected, normalized)) {
      return { code: normalized, timeStep };
    }
  }

  return null;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    formatRecoveryCode(
      encodeBase32(randomBytes(RECOVERY_CODE_BYTES)).slice(0, 16),
    ),
  );
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

function normalizeTotpCode(code: string): string | null {
  const normalized = code.trim().replace(/\s/g, '');
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

function getTotpTimeStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function formatRecoveryCode(code: string): string {
  return (
    code
      .match(new RegExp(`.{1,${RECOVERY_CODE_GROUP_SIZE}}`, 'g'))
      ?.join('-') ?? code
  );
}

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret
    .replace(/\s/g, '')
    .replace(/=+$/g, '')
    .toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error('Invalid TOTP secret');
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}
