import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Response } from 'express';
import type { SignOptions } from 'jsonwebtoken';
import { IsNull, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { type AppLanguage, normalizeLanguage } from '../common/i18n/i18n';
import {
  expiresFromDuration,
  isAfterNow,
  isBeforeNow,
  nowDate,
  toIsoString,
  toNullableIsoString,
} from '../common/utils/date';
import { SkinProfileResponseDto } from '../skin-profile/dto/skin-profile-response.dto';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { MAIL_PROVIDER_LABEL } from '../mail/mail.constants';
import { MailService } from '../mail/mail.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { AuthSession } from './entities/auth-session.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
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
  private readonly webAppUrl: string;
  private readonly nodeEnv: string;

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
    this.passwordResetExpiry = configService.get('PASSWORD_RESET_EXPIRY', '1h');
    this.termsVersion = configService.get('LEGAL_TERMS_VERSION', '1.0.0');
    this.privacyVersion = configService.get('LEGAL_PRIVACY_VERSION', '1.0.0');
    this.webAppUrl = configService.get('WEB_APP_URL', 'http://localhost:3000');
    this.nodeEnv = configService.get('NODE_ENV', 'development');
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
    ip?: string,
  ): Promise<RegisterResponseDto> {
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
      email_verification_expires: this.expiresIn(this.emailVerificationExpiry),
    });

    await this.recordConsents(user.id, ip, [
      { type: 'terms_of_service', version: this.termsVersion },
      { type: 'privacy_policy', version: this.privacyVersion },
    ]);

    await this.sendVerificationEmailOrLogFailure(
      user.email,
      verificationToken,
      user.first_name,
      normalizeLanguage(dto.preferredLanguage),
    );

    return new RegisterResponseDto(
      'Verify your email to activate your account',
      UserResponseDto.fromEntity(user),
    );
  }

  async login(
    email: string,
    password: string,
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmailForAuth(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.email_verified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email not verified',
      });
    }

    const { accessToken } = await this.createSession(user, res, ip, userAgent);

    return new AuthResponseDto(accessToken, UserResponseDto.fromEntity(user));
  }

  async refreshTokens(
    refreshTokenRaw: string,
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; preferredLanguage: string }> {
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

    if (isBeforeNow(session.expires_at)) {
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
    session.last_used_at = nowDate();
    if (ip) {
      session.ip_address = ip;
    }
    if (userAgent) {
      session.user_agent = userAgent;
    }
    await this.sessionsRepository.save(session);

    const newRefreshToken = `${session.id}.${newSecret}`;
    this.setRefreshCookie(res, newRefreshToken);

    const accessToken = this.generateAccessToken(session.user, session.id);

    return {
      accessToken,
      preferredLanguage: session.user.preferred_language,
    };
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

    if (isBeforeNow(user.email_verification_expires)) {
      throw new BadRequestException('Verification token has expired');
    }

    await this.usersService.update(user.id, {
      email_verified: true,
      email_verification_token_hash: null,
      email_verification_expires: null,
    });
  }

  async resendVerification(
    email: string,
    language?: AppLanguage,
  ): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.email_verified) {
      return;
    }

    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenHash = this.sha256(verificationToken);

    await this.usersService.update(user.id, {
      email_verification_token_hash: verificationTokenHash,
      email_verification_expires: this.expiresIn(this.emailVerificationExpiry),
    });

    await this.sendVerificationEmailOrLogFailure(
      user.email,
      verificationToken,
      user.first_name,
      language ?? normalizeLanguage(user.preferred_language),
    );
  }

  async forgotPassword(email: string, language?: AppLanguage): Promise<void> {
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

    await this.sendPasswordResetEmailOrLogFailure(
      user.email,
      resetToken,
      user.first_name,
      language ?? normalizeLanguage(user.preferred_language),
    );
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

    if (isBeforeNow(user.password_reset_expires)) {
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

  async logout(refreshTokenRaw: string, res: Response): Promise<void> {
    const parsedRefreshToken = this.parseRefreshToken(refreshTokenRaw);

    if (!parsedRefreshToken) {
      this.clearRefreshCookie(res);
      return;
    }

    const session = await this.sessionsRepository.findOne({
      where: { id: parsedRefreshToken.sessionId },
    });

    if (!session || session.revoked_at || isBeforeNow(session.expires_at)) {
      this.clearRefreshCookie(res);
      return;
    }

    const secretHash = this.sha256(parsedRefreshToken.secret);
    const storedHash = session.refresh_token_hash;
    const secretsMatch = this.timingSafeCompare(
      Buffer.from(secretHash, 'hex'),
      Buffer.from(storedHash, 'hex'),
    );

    if (!secretsMatch) {
      this.clearRefreshCookie(res);
      return;
    }

    session.revoked_at = nowDate();
    await this.sessionsRepository.save(session);
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
      .filter((s) => isAfterNow(s.expires_at))
      .map((session) => SessionResponseDto.fromEntity(session));
  }

  async exportData(
    userId: string,
    password: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.usersService.findByIdForAuth(userId);
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
        grantedAt: toNullableIsoString(c.granted_at),
        revokedAt: toNullableIsoString(c.revoked_at),
        createdAt: toIsoString(c.created_at),
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.user_agent,
        ipAddress: s.ip_address,
        createdAt: toIsoString(s.created_at),
        lastUsedAt: toIsoString(s.last_used_at),
        revokedAt: toNullableIsoString(s.revoked_at),
      })),
    };
  }

  async deleteAccount(
    userId: string,
    password: string,
    res: Response,
  ): Promise<void> {
    const user = await this.usersService.findByIdForAuth(userId);
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
  ): Promise<{ accessToken: string }> {
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
      last_used_at: nowDate(),
    });
    await this.sessionsRepository.save(session);

    this.setRefreshCookie(res, refreshToken);
    const accessToken = this.generateAccessToken(user, sessionId);

    return { accessToken };
  }

  private generateAccessToken(user: User, sessionId: string): string {
    const expiresIn = this.jwtAccessExpiry as SignOptions['expiresIn'];

    return this.jwtService.sign(
      { sub: user.id, email: user.email, sid: sessionId },
      {
        expiresIn,
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
      { revoked_at: nowDate() },
    );
  }

  private async recordConsents(
    userId: string,
    ip: string | undefined,
    consents: { type: string; version: string }[],
  ): Promise<void> {
    const now = nowDate();
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

  private async sendVerificationEmailOrLogFailure(
    email: string,
    token: string,
    firstName: string,
    language: AppLanguage,
  ): Promise<void> {
    try {
      await this.mailService.sendVerificationEmail(
        email,
        token,
        firstName,
        language,
      );
    } catch (error) {
      this.logEmailDeliveryFailure(
        'verification',
        email,
        this.buildFrontendPathActionUrl('verify-email', token),
        error,
      );
    }
  }

  private async sendPasswordResetEmailOrLogFailure(
    email: string,
    token: string,
    firstName: string,
    language: AppLanguage,
  ): Promise<void> {
    try {
      await this.mailService.sendPasswordResetEmail(
        email,
        token,
        firstName,
        language,
      );
    } catch (error) {
      this.logEmailDeliveryFailure(
        'password reset',
        email,
        this.buildFrontendPathActionUrl('reset-password', token),
        error,
      );
    }
  }

  private logEmailDeliveryFailure(
    type: 'verification' | 'password reset',
    email: string,
    actionUrl: string,
    error: unknown,
  ): void {
    const message =
      error instanceof Error ? error.message : 'Unknown email delivery error';
    const stack = error instanceof Error ? error.stack : undefined;

    this.logger.error(
      `Failed to send ${type} email to ${email} via ${MAIL_PROVIDER_LABEL}: ${message}`,
      stack,
    );

    if (this.nodeEnv !== 'development') {
      return;
    }

    this.logger.warn(
      `${MAIL_PROVIDER_LABEL} delivery failed in development. Check your RESEND_API_KEY and verified MAIL_FROM address. ` +
        `Temporary ${type} URL for ${email}: ${actionUrl}`,
    );
  }

  private buildFrontendActionUrl(path: string, token: string): string {
    const url = new URL(path, `${this.webAppUrl}/`);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private buildFrontendPathActionUrl(path: string, token: string): string {
    const base = new URL(this.webAppUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = `${basePath}/${path}/${encodeURIComponent(token)}`;
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  private sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private parseRefreshToken(
    refreshTokenRaw: string,
  ): { sessionId: string; secret: string } | null {
    const dotIndex = refreshTokenRaw.indexOf('.');

    if (dotIndex <= 0 || dotIndex === refreshTokenRaw.length - 1) {
      return null;
    }

    return {
      sessionId: refreshTokenRaw.substring(0, dotIndex),
      secret: refreshTokenRaw.substring(dotIndex + 1),
    };
  }

  private timingSafeCompare(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  private expiresIn(duration: string): Date {
    return expiresFromDuration(duration);
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
