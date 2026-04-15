import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { IsNull, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { SkinProfileResponseDto } from '../skin-profile/dto/skin-profile-response.dto';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { AuthSession } from './entities/auth-session.entity';

@Injectable()
export class AuthService {
  private readonly jwtAccessExpiry: string;
  private readonly jwtRefreshExpiry: string;
  private readonly jwtIssuer: string;
  private readonly jwtAudience: string;
  private readonly jwtRefreshSecret: string;
  private readonly bcryptRounds: number;
  private readonly cookieDomain: string;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'lax' | 'strict' | 'none';
  private readonly cookieRefreshName: string;
  private readonly emailVerificationExpiry: string;
  private readonly passwordResetExpiry: string;
  private readonly termsVersion: string;
  private readonly privacyVersion: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    @InjectRepository(AuthSession)
    private readonly sessionsRepository: Repository<AuthSession>,
    @InjectRepository(UserConsent)
    private readonly consentsRepository: Repository<UserConsent>,
    @InjectRepository(SkinProfile)
    private readonly skinProfileRepository: Repository<SkinProfile>,
  ) {
    this.jwtAccessExpiry = configService.get('JWT_ACCESS_EXPIRY', '15m');
    this.jwtRefreshExpiry = configService.get('JWT_REFRESH_EXPIRY', '7d');
    this.jwtIssuer = configService.get('JWT_ISSUER', 'ritora');
    this.jwtAudience = configService.get('JWT_AUDIENCE', 'ritora-web');
    this.jwtRefreshSecret = configService.get('JWT_REFRESH_SECRET', '');
    this.bcryptRounds = configService.get('BCRYPT_SALT_ROUNDS', 12);
    this.cookieDomain = configService.get('COOKIE_DOMAIN', '');
    this.cookieSecure = configService.get('COOKIE_SECURE', false);
    this.cookieSameSite = configService.get('COOKIE_SAME_SITE', 'lax');
    this.cookieRefreshName = configService.get(
      'COOKIE_REFRESH_NAME',
      'ritora_refresh',
    );
    this.emailVerificationExpiry = configService.get(
      'EMAIL_VERIFICATION_EXPIRY',
      '24h',
    );
    this.passwordResetExpiry = configService.get(
      'PASSWORD_RESET_EXPIRY',
      '1h',
    );
    this.termsVersion = configService.get('LEGAL_TERMS_VERSION', '1.0.0');
    this.privacyVersion = configService.get('LEGAL_PRIVACY_VERSION', '1.0.0');
  }

  async register(
    dto: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      preferredLanguage: string;
      termsAccepted: boolean;
      privacyPolicyAccepted: boolean;
    },
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    if (!dto.termsAccepted || !dto.privacyPolicyAccepted) {
      throw new BadRequestException(
        'You must accept the terms of service and privacy policy',
      );
    }

    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenHash = this.sha256(verificationToken);

    const user = await this.usersService.create({
      email: dto.email,
      password_hash: passwordHash,
      first_name: dto.firstName,
      last_name: dto.lastName,
      preferred_language: dto.preferredLanguage,
      email_verification_token_hash: verificationTokenHash,
      email_verification_expires: this.expiresIn(
        this.emailVerificationExpiry,
      ),
    });

    await this.recordConsents(user.id, ip, [
      { type: 'terms_of_service', version: this.termsVersion },
      { type: 'privacy_policy', version: this.privacyVersion },
    ]);

    await this.mailService
      .sendVerificationEmail(user.email, verificationToken, user.first_name)
      .catch(() => {});

    const { accessToken, refreshToken } = await this.createSession(
      user,
      res,
      ip,
      userAgent,
    );

    return {
      accessToken,
      user: UserResponseDto.fromEntity(user),
    };
  }

  async login(
    email: string,
    password: string,
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken } = await this.createSession(
      user,
      res,
      ip,
      userAgent,
    );

    return {
      accessToken,
      user: UserResponseDto.fromEntity(user),
    };
  }

  async refreshTokens(
    refreshTokenRaw: string,
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string }> {
    const dotIndex = refreshTokenRaw.indexOf('.');
    if (dotIndex === -1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const sessionId = refreshTokenRaw.substring(0, dotIndex);
    const secret = refreshTokenRaw.substring(dotIndex + 1);

    const session = await this.sessionsRepository.findOne({
      where: { id: sessionId },
      relations: ['user'],
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revoked_at) {
      await this.revokeAllSessions(session.user_id);
      throw new UnauthorizedException(
        'Refresh token has been revoked — all sessions invalidated',
      );
    }

    if (session.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const secretHash = this.sha256(secret);
    const storedHash = session.refresh_token_hash;

    if (
      !this.timingSafeCompare(
        Buffer.from(secretHash, 'hex'),
        Buffer.from(storedHash, 'hex'),
      )
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newSecret = randomBytes(32).toString('hex');
    const newSecretHash = this.sha256(newSecret);
    session.refresh_token_hash = newSecretHash;
    session.last_used_at = new Date();
    await this.sessionsRepository.save(session);

    const newRefreshToken = `${session.id}.${newSecret}`;
    this.setRefreshCookie(res, newRefreshToken);

    const accessToken = this.generateAccessToken(session.user);

    return { accessToken };
  }

  async verifyEmail(token: string): Promise<void> {
    const tokenHash = this.sha256(token);

    const user = await this.findUserByField(
      'email_verification_token_hash',
      tokenHash,
    );

    if (!user || !user.email_verification_expires) {
      throw new BadRequestException('Invalid verification token');
    }

    if (user.email_verification_expires < new Date()) {
      throw new BadRequestException('Verification token has expired');
    }

    await this.usersService.update(user.id, {
      email_verified: true,
      email_verification_token_hash: null,
      email_verification_expires: null,
    });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.email_verified) {
      return;
    }

    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenHash = this.sha256(verificationToken);

    await this.usersService.update(user.id, {
      email_verification_token_hash: verificationTokenHash,
      email_verification_expires: this.expiresIn(
        this.emailVerificationExpiry,
      ),
    });

    await this.mailService
      .sendVerificationEmail(user.email, verificationToken, user.first_name)
      .catch(() => {});
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return;
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetTokenHash = this.sha256(resetToken);

    await this.usersService.update(user.id, {
      password_reset_token_hash: resetTokenHash,
      password_reset_expires: this.expiresIn(this.passwordResetExpiry),
    });

    await this.mailService
      .sendPasswordResetEmail(user.email, resetToken, user.first_name)
      .catch(() => {});
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.sha256(token);

    const user = await this.findUserByField(
      'password_reset_token_hash',
      tokenHash,
    );

    if (!user || !user.password_reset_expires) {
      throw new BadRequestException('Invalid reset token');
    }

    if (user.password_reset_expires < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptRounds);

    await this.usersService.update(user.id, {
      password_hash: passwordHash,
      password_reset_token_hash: null,
      password_reset_expires: null,
    });

    await this.revokeAllSessions(user.id);
  }

  async logout(sessionId: string, res: Response): Promise<void> {
    const session = await this.sessionsRepository.findOne({
      where: { id: sessionId },
    });

    if (session && !session.revoked_at) {
      session.revoked_at = new Date();
      await this.sessionsRepository.save(session);
    }

    this.clearRefreshCookie(res);
  }

  async logoutAll(userId: string, res: Response): Promise<void> {
    await this.revokeAllSessions(userId);
    this.clearRefreshCookie(res);
  }

  async getMe(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    return UserResponseDto.fromEntity(user);
  }

  async getSessions(userId: string): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionsRepository.find({
      where: { user_id: userId, revoked_at: IsNull() },
      order: { last_used_at: 'DESC' },
    });

    return sessions
      .filter((s) => s.expires_at > new Date())
      .map(SessionResponseDto.fromEntity);
  }

  async exportData(
    userId: string,
    password: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid password');
    }

    const consents = await this.consentsRepository.find({
      where: { user_id: userId },
    });

    const sessions = await this.sessionsRepository.find({
      where: { user_id: userId },
    });
    const skinProfile = await this.skinProfileRepository.findOne({
      where: { user_id: userId },
    });

    return {
      user: UserResponseDto.fromEntity(user),
      skinProfile: skinProfile
        ? SkinProfileResponseDto.fromEntity(skinProfile)
        : null,
      consents: consents.map((c) => ({
        consentType: c.consent_type,
        consentVersion: c.consent_version,
        granted: c.granted,
        grantedAt: c.granted_at?.toISOString() ?? null,
        revokedAt: c.revoked_at?.toISOString() ?? null,
        createdAt: c.created_at.toISOString(),
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.user_agent,
        ipAddress: s.ip_address,
        createdAt: s.created_at.toISOString(),
        lastUsedAt: s.last_used_at.toISOString(),
        revokedAt: s.revoked_at?.toISOString() ?? null,
      })),
    };
  }

  async deleteAccount(
    userId: string,
    password: string,
    res: Response,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid password');
    }

    await this.usersService.remove(userId);
    this.clearRefreshCookie(res);
  }

  // --- Private helpers ---

  private async createSession(
    user: User,
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const sessionId = ulid();
    const secret = randomBytes(32).toString('hex');
    const secretHash = this.sha256(secret);
    const refreshToken = `${sessionId}.${secret}`;

    const session = this.sessionsRepository.create({
      id: sessionId,
      user_id: user.id,
      refresh_token_hash: secretHash,
      expires_at: this.expiresIn(this.jwtRefreshExpiry),
      user_agent: userAgent ?? null,
      ip_address: ip ?? null,
      last_used_at: new Date(),
    });
    await this.sessionsRepository.save(session);

    this.setRefreshCookie(res, refreshToken);
    const accessToken = this.generateAccessToken(user);

    return { accessToken, refreshToken };
  }

  private generateAccessToken(user: User): string {
    return this.jwtService.sign(
      { sub: user.id, email: user.email },
      {
        expiresIn: this.jwtAccessExpiry as any,
        issuer: this.jwtIssuer,
        audience: this.jwtAudience,
      },
    );
  }

  private setRefreshCookie(res: Response, token: string): void {
    const cookieOptions: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'lax' | 'strict' | 'none';
      path: string;
      maxAge: number;
      domain?: string;
    } = {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/api/v1/auth',
      maxAge: this.parseExpiryMs(this.jwtRefreshExpiry),
    };

    if (this.cookieDomain) {
      cookieOptions.domain = this.cookieDomain;
    }

    res.cookie(this.cookieRefreshName, token, cookieOptions);
  }

  private clearRefreshCookie(res: Response): void {
    const cookieOptions: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'lax' | 'strict' | 'none';
      path: string;
      domain?: string;
    } = {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/api/v1/auth',
    };

    if (this.cookieDomain) {
      cookieOptions.domain = this.cookieDomain;
    }

    res.clearCookie(this.cookieRefreshName, cookieOptions);
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.sessionsRepository.update(
      { user_id: userId, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  private async recordConsents(
    userId: string,
    ip: string | undefined,
    consents: { type: string; version: string }[],
  ): Promise<void> {
    const now = new Date();
    const entities = consents.map((c) =>
      this.consentsRepository.create({
        id: ulid(),
        user_id: userId,
        consent_type: c.type,
        consent_version: c.version,
        granted: true,
        granted_at: now,
        ip_address: ip ?? null,
      }),
    );
    await this.consentsRepository.save(entities);
  }

  private async findUserByField(
    field: 'email_verification_token_hash' | 'password_reset_token_hash',
    value: string,
  ): Promise<User | null> {
    if (field === 'email_verification_token_hash') {
      return this.usersService.findByVerificationTokenHash(value);
    }
    return this.usersService.findByResetTokenHash(value);
  }

  private sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private timingSafeCompare(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  private expiresIn(duration: string): Date {
    return new Date(Date.now() + this.parseExpiryMs(duration));
  }

  private parseExpiryMs(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 15 * 60 * 1000; // default 15m
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 15 * 60 * 1000;
    }
  }
}
