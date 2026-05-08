import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import {
  NOTIFICATION_KIND_TEMPLATE,
  NOTIFICATION_KINDS_WITHOUT_LIST_UNSUBSCRIBE,
  type NotificationEmailKind,
} from './mail.constants';

export type MailUnsubscribeTokenPayload = {
  userId: string;
  kind: NotificationEmailKind;
};

type EncodedMailUnsubscribeTokenPayload = {
  p: typeof MAIL_UNSUBSCRIBE_TOKEN_PURPOSE;
  v: 1;
  sub: string;
  k: NotificationEmailKind;
  exp: number;
};

const MAIL_UNSUBSCRIBE_TOKEN_PURPOSE = 'notification-email-unsubscribe';
const MAIL_UNSUBSCRIBE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAIL_UNSUBSCRIBE_TOKEN_VERSION = 'v1';
const MAIL_UNSUBSCRIBE_TOKEN_IV_BYTES = 12;

@Injectable()
export class MailUnsubscribeTokenService {
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    this.secret =
      this.configService.get<string>('MAIL_UNSUBSCRIBE_SECRET')?.trim() ?? '';
  }

  createToken(
    payload: MailUnsubscribeTokenPayload,
    now: Date = new Date(),
  ): string {
    if (!this.secret) {
      throw new Error('MAIL_UNSUBSCRIBE_SECRET is not configured');
    }
    if (!isUnsubscribableKind(payload.kind)) {
      throw new Error('Unsupported unsubscribe kind');
    }

    const encodedPayload: EncodedMailUnsubscribeTokenPayload = {
      p: MAIL_UNSUBSCRIBE_TOKEN_PURPOSE,
      v: 1,
      sub: payload.userId,
      k: payload.kind,
      exp:
        Math.floor(now.getTime() / 1000) + MAIL_UNSUBSCRIBE_TOKEN_TTL_SECONDS,
    };
    const iv = randomBytes(MAIL_UNSUBSCRIBE_TOKEN_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(this.secret), iv);
    cipher.setAAD(Buffer.from(MAIL_UNSUBSCRIBE_TOKEN_PURPOSE));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(encodedPayload), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      MAIL_UNSUBSCRIBE_TOKEN_VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      authTag.toString('base64url'),
    ].join('.');
  }

  verifyToken(
    token: string | null | undefined,
    now: Date = new Date(),
  ): MailUnsubscribeTokenPayload | null {
    if (!this.secret || typeof token !== 'string') {
      return null;
    }

    const tokenParts = token.split('.');
    if (tokenParts.length !== 4) {
      return null;
    }
    const [versionPart, ivPart, ciphertextPart, authTagPart] = tokenParts;
    if (
      versionPart !== MAIL_UNSUBSCRIBE_TOKEN_VERSION ||
      !ivPart ||
      !ciphertextPart ||
      !authTagPart
    ) {
      return null;
    }
    const parsedPayload = decryptPayload(
      {
        ivPart,
        ciphertextPart,
        authTagPart,
      },
      this.secret,
    );
    if (!parsedPayload) {
      return null;
    }
    if (parsedPayload.exp <= Math.floor(now.getTime() / 1000)) {
      return null;
    }
    if (!isUnsubscribableKind(parsedPayload.k)) {
      return null;
    }

    return {
      userId: parsedPayload.sub,
      kind: parsedPayload.k,
    };
  }
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function decryptPayload(
  token: {
    ivPart: string;
    ciphertextPart: string;
    authTagPart: string;
  },
  secret: string,
): EncodedMailUnsubscribeTokenPayload | null {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(secret),
      Buffer.from(token.ivPart, 'base64url'),
    );
    decipher.setAAD(Buffer.from(MAIL_UNSUBSCRIBE_TOKEN_PURPOSE));
    decipher.setAuthTag(Buffer.from(token.authTagPart, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(token.ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const parsed: unknown = JSON.parse(plaintext);
    if (!isPayloadObject(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isPayloadObject(
  value: unknown,
): value is EncodedMailUnsubscribeTokenPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.p === MAIL_UNSUBSCRIBE_TOKEN_PURPOSE &&
    candidate.v === 1 &&
    typeof candidate.sub === 'string' &&
    candidate.sub.length > 0 &&
    candidate.sub.length <= 64 &&
    typeof candidate.k === 'string' &&
    candidate.k in NOTIFICATION_KIND_TEMPLATE &&
    typeof candidate.exp === 'number' &&
    Number.isInteger(candidate.exp)
  );
}

function isUnsubscribableKind(
  kind: NotificationEmailKind,
): kind is NotificationEmailKind {
  return !NOTIFICATION_KINDS_WITHOUT_LIST_UNSUBSCRIBE.has(kind);
}
