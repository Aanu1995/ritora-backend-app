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
import { IsNull, Repository } from 'typeorm';
import { isBeforeNow } from '../common/utils/date';
import {
  AdminAccount,
  AdminAccountStatus,
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

const ADMIN_TOKEN_TYPE = 'admin';

@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  private readonly jwtSecret: string;
  private readonly jwtIssuer: string;
  private readonly jwtAudience: string;

  constructor(
    configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(AdminAccount)
    private readonly accountsRepository: Repository<AdminAccount>,
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

    const session = await this.sessionsRepository.findOne({
      where: {
        admin_id: adminId,
        id: sessionId,
        revoked_at: IsNull(),
      },
    });

    if (!session || isBeforeNow(session.expires_at)) {
      throw new UnauthorizedException();
    }

    const account = await this.accountsRepository.findOne({
      where: {
        id: adminId,
        deleted_at: IsNull(),
        status: AdminAccountStatus.Active,
      },
    });

    if (!account) {
      throw new UnauthorizedException();
    }

    request.user = {
      email: account.email,
      id: account.id,
      name: account.name,
      role: account.role,
      sessionId: session.id,
      status: account.status,
    };

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
}
