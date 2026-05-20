import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { isBeforeNow } from '../../common/utils/date';
import { UsersService } from '../../users/users.service';
import { AuthSession } from '../entities/auth-session.entity';

interface JwtPayload {
  sub: string;
  email: string;
  sid: string;
  iss: string;
  aud: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
    @InjectRepository(AuthSession)
    private readonly sessionsRepository: Repository<AuthSession>,
  ) {
    const issuer = configService.getOrThrow<string>('JWT_ISSUER');
    const audience = configService.getOrThrow<string>('JWT_AUDIENCE');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      issuer,
      audience,
    });
  }

  async validate(payload: JwtPayload) {
    const session = await this.sessionsRepository.findOne({
      where: {
        id: payload.sid,
        user_id: payload.sub,
        revoked_at: IsNull(),
      },
    });

    if (!session || isBeforeNow(session.expires_at)) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || user.account_restricted_at) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      email: user.email,
      language: user.preferred_language,
      timeZone: user.time_zone,
      sessionId: session.id,
    };
  }
}
