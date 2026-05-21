import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import {
  clearUserRestrictionState,
  hasActiveUserRestrictionCapability,
  isUserRestrictionExpired,
  type MutableUserRestrictionState,
  UserRestrictionCapability,
} from '../../users/user-restrictions';
import { UsersService } from '../../users/users.service';
import { AuthSession } from '../entities/auth-session.entity';

interface JwtPayload {
  sub: string;
  email: string;
  sid: string;
  iss: string;
  aud: string;
}

type SessionUserRow = {
  account_restricted_at?: unknown;
  account_restriction_capabilities?: unknown;
  account_restriction_expires_at?: unknown;
  email?: unknown;
  preferred_language?: unknown;
  session_id?: unknown;
  time_zone?: unknown;
  user_id?: unknown;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @InjectRepository(AuthSession)
    private readonly sessionsRepository: Repository<AuthSession>,
    private readonly usersService: UsersService,
  ) {
    const issuer = configService.getOrThrow<string>('JWT_ISSUER');
    const audience = configService.getOrThrow<string>('JWT_AUDIENCE');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      issuer,
      audience,
    });
  }

  async validate(
    requestOrPayload: Request | JwtPayload,
    maybePayload?: JwtPayload,
  ) {
    const request = maybePayload ? (requestOrPayload as Request) : undefined;
    const payload = maybePayload ?? (requestOrPayload as JwtPayload);
    const row = await this.findActiveSessionUser(payload);
    if (!row) {
      throw new UnauthorizedException();
    }

    const restrictionSnapshot: MutableUserRestrictionState = {
      account_restricted_at: toDateLike(row.account_restricted_at),
      account_restriction_capabilities: toNullableStringArray(
        row.account_restriction_capabilities,
      ),
      account_restriction_expires_at: toDateLike(
        row.account_restriction_expires_at,
      ),
    };

    if (isUserRestrictionExpired(restrictionSnapshot)) {
      await this.usersService.clearExpiredAccountRestriction(
        toRequiredString(row.user_id),
      );
      clearUserRestrictionState(restrictionSnapshot);
    }
    const restrictionCapabilities = toStringArray(
      restrictionSnapshot.account_restriction_capabilities,
    );

    if (
      hasActiveUserRestrictionCapability(
        restrictionSnapshot,
        UserRestrictionCapability.DisableLogin,
      ) &&
      !isPrivacyLegalFlow(request)
    ) {
      throw new UnauthorizedException();
    }

    return {
      account_restricted_at: restrictionSnapshot.account_restricted_at,
      account_restriction_capabilities:
        restrictionCapabilities.length > 0 ? restrictionCapabilities : null,
      account_restriction_expires_at:
        restrictionSnapshot.account_restriction_expires_at,
      id: toRequiredString(row.user_id),
      email: toRequiredString(row.email),
      language: toRequiredString(row.preferred_language),
      timeZone: toNullableString(row.time_zone),
      sessionId: toRequiredString(row.session_id),
    };
  }

  private async findActiveSessionUser(
    payload: JwtPayload,
  ): Promise<SessionUserRow | null> {
    const result = (await this.sessionsRepository.query(
      `
        SELECT
          sessions.id AS session_id,
          users.id AS user_id,
          users.email,
          users.preferred_language,
          users.time_zone,
          users.account_restricted_at,
          users.account_restriction_capabilities,
          users.account_restriction_expires_at
        FROM auth_sessions sessions
        INNER JOIN users users
          ON users.id = sessions.user_id
        WHERE sessions.id = $1
          AND sessions.user_id = $2
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > now()
        LIMIT 1
      `,
      [payload.sid, payload.sub],
    )) as unknown;
    const rows: readonly unknown[] = Array.isArray(result) ? result : [];
    if (rows.length === 0) {
      return null;
    }

    const row: unknown = rows[0];
    if (!row || typeof row !== 'object') {
      return null;
    }

    const sessionUser = row as SessionUserRow;
    return isValidSessionUserRow(sessionUser) ? sessionUser : null;
  }
}

function isPrivacyLegalFlow(request: Request | undefined): boolean {
  if (!request) {
    return false;
  }

  const method = request.method.toUpperCase();
  const path = request.originalUrl || request.path || request.url;
  return (
    (method === 'POST' && path.endsWith('/auth/export')) ||
    (method === 'DELETE' && path.endsWith('/auth/account'))
  );
}

function toRequiredString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isValidSessionUserRow(row: SessionUserRow): boolean {
  return (
    typeof row.session_id === 'string' &&
    typeof row.user_id === 'string' &&
    typeof row.email === 'string' &&
    typeof row.preferred_language === 'string'
  );
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toDateLike(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === 'string' ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function toNullableStringArray(value: unknown): string[] | null {
  const items = toStringArray(value);
  return items.length > 0 ? items : null;
}
