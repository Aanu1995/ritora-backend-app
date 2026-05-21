import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import {
  AdminAccountStatus,
  AdminAccountRole,
} from './entities/admin-account.entity';
import { AdminSession } from './entities/admin-session.entity';
import type { AdminAuthenticatedUser } from './admin.types';

type AdminJwtPayload = {
  sub?: unknown;
  email?: unknown;
  sid?: unknown;
  typ?: unknown;
};

type AdminRequest = Request & {
  user?: AdminAuthenticatedUser;
};

type AdminSessionLookupRow = {
  account_email?: unknown;
  account_id?: unknown;
  account_name?: unknown;
  account_role?: unknown;
  account_status?: unknown;
  session_id?: unknown;
};

const ADMIN_TOKEN_TYPE = 'admin';

@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  private readonly jwtSecret: string;
  private readonly jwtIssuer: string;
  private readonly jwtAudience: string;

  constructor(
    configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(AdminSession)
    private readonly sessionsRepository: Repository<AdminSession>,
  ) {
    this.jwtSecret = configService.getOrThrow('JWT_SECRET');
    this.jwtIssuer = configService.getOrThrow('JWT_ISSUER');
    this.jwtAudience = configService.getOrThrow('JWT_AUDIENCE');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = this.getBearerToken(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    const payload = await this.verifyPayload(token);
    const adminId = typeof payload.sub === 'string' ? payload.sub : '';
    const sessionId = typeof payload.sid === 'string' ? payload.sid : '';

    if (payload.typ !== ADMIN_TOKEN_TYPE || !adminId || !sessionId) {
      throw new UnauthorizedException();
    }

    const activeAdmin = await this.findActiveSessionAccount(sessionId, adminId);
    if (!activeAdmin) {
      throw new UnauthorizedException();
    }

    request.user = activeAdmin;

    return true;
  }

  private async verifyPayload(token: string): Promise<AdminJwtPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AdminJwtPayload>(
        token,
        {
          audience: this.jwtAudience,
          issuer: this.jwtIssuer,
          secret: this.jwtSecret,
        },
      );
      return payload;
    } catch {
      throw new UnauthorizedException();
    }
  }

  private getBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (typeof header !== 'string') {
      return null;
    }

    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }

  private async findActiveSessionAccount(
    sessionId: string,
    adminId: string,
  ): Promise<AdminAuthenticatedUser | null> {
    const result = (await this.sessionsRepository.query(
      `
        SELECT
          admin_session.id AS session_id,
          account.id AS account_id,
          account.email AS account_email,
          account.name AS account_name,
          account.role AS account_role,
          account.status AS account_status
        FROM admin_sessions admin_session
        JOIN admin_accounts account
          ON account.id = admin_session.admin_id
        WHERE admin_session.id = $1
          AND admin_session.admin_id = $2
          AND admin_session.revoked_at IS NULL
          AND admin_session.expires_at > now()
          AND account.deleted_at IS NULL
          AND account.status = $3
        LIMIT 1
      `,
      [sessionId, adminId, AdminAccountStatus.Active],
    )) as unknown;
    const row = Array.isArray(result)
      ? (result[0] as AdminSessionLookupRow | undefined)
      : undefined;

    if (
      typeof row?.session_id !== 'string' ||
      typeof row.account_id !== 'string' ||
      typeof row.account_email !== 'string' ||
      typeof row.account_name !== 'string' ||
      !this.isAdminRole(row.account_role) ||
      row.account_status !== AdminAccountStatus.Active
    ) {
      return null;
    }

    return {
      email: row.account_email,
      id: row.account_id,
      name: row.account_name,
      role: row.account_role,
      sessionId: row.session_id,
      status: AdminAccountStatus.Active,
    };
  }

  private isAdminRole(value: unknown): value is AdminAccountRole {
    return value === AdminAccountRole.Admin || value === AdminAccountRole.Root;
  }
}
