import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(configService: ConfigService) {
    const cookieName = configService.get<string>(
      'COOKIE_REFRESH_NAME',
      'ritora_refresh',
    );

    super({
      jwtFromRequest: (req: Request) => {
        return req?.cookies?.[cookieName] ?? null;
      },
      ignoreExpiration: true,
      secretOrKey: configService.get<string>('JWT_REFRESH_SECRET')!,
      passReqToCallback: true,
    } as ConstructorParameters<typeof Strategy>[0]);
  }

  validate(req: Request) {
    const cookieName = 'ritora_refresh';
    const refreshToken: string | undefined = req.cookies?.[cookieName];
    return { refreshToken };
  }
}
