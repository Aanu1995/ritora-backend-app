import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcrypt';
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
import { getSensitiveSkinProfileConsentTypes } from '../skin-profile/skin-profile-sensitive-data';
import { SkinJournalService } from '../skin-journal/skin-journal.service';
import type { SkinJournalExportPayload } from '../skin-journal/skin-journal.constants';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { UsersService } from '../users/users.service';
import { MAIL_PROVIDER_LABEL } from '../mail/mail.constants';
import { MailService } from '../mail/mail.service';
import { sanitizeIpAddress, sanitizeUserAgent } from './auth-session.utils';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { AuthSession } from './entities/auth-session.entity';
import { OAuthIdentityProfile, OAuthProvider } from './oauth/oauth-profile';
import { SmartPickProductSuggestion } from '../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../smart-picks/entities/smart-pick-snapshot.entity';
import { SuggestionGapAction } from '../suggestions/entities/suggestion-gap-action.entity';

type AccountExportConsent = {
  consentType: UserConsentType;
  consentVersion: string;
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type AccountExportSession = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
};

type AccountExportData = {
  user: UserResponseDto;
  skinProfile: SkinProfileResponseDto | null;
  skinJournal: SkinJournalExportPayload | null;
  smartPicks: AccountExportSmartPicks;
  consents: AccountExportConsent[];
  sessions: AccountExportSession[];
};

type AccountExportSmartPicks = {
  snapshots: Array<{
    mode: string;
    coverage: unknown;
    gaps: unknown;
    covered: unknown;
    redundancy: unknown;
    recap: unknown;
    inputsHash: string;
    generatedAt: string;
  }>;
  productSuggestions: Array<{
    ingredientOrCategory: string;
    normalizedKey: string;
    brand: string;
    productName: string;
    budgetTier: string | null;
    sellerNames: string[];
    recommendationRankReason: string | null;
    sourceIds: string[];
    gapReason: string | null;
    goalAlignment: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  actions: Array<{
    sourceType: string;
    ingredientOrCategory: string;
    normalizedKey: string;
    action: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

type OAuthProviderConfig = {
  displayName: string;
  findBySubject: (subject: string) => Promise<User | null>;
  readSubject: (user: User) => string | null;
  linkSubject: (id: string, subject: string) => Promise<User>;
  createUser: (data: {
    email: string;
    subject: string;
    firstName: string;
    lastName: string;
    preferredLanguage: string;
  }) => Promise<User>;
};

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
    @InjectRepository(SmartPickSnapshot)
    private readonly smartPickSnapshotRepository: Repository<SmartPickSnapshot>,
    @InjectRepository(SmartPickProductSuggestion)
    private readonly smartPickProductSuggestionRepository: Repository<SmartPickProductSuggestion>,
    @InjectRepository(SuggestionGapAction)
    private readonly suggestionGapActionRepository: Repository<SuggestionGapAction>,
    private readonly dataAccessLogService: UserDataAccessLogService,
    private readonly skinJournalService: SkinJournalService,
  ) {
    this.jwtAccessExpiry = configService.getOrThrow('JWT_ACCESS_EXPIRY');
    this.jwtRefreshExpiry = configService.getOrThrow('JWT_REFRESH_EXPIRY');
    this.jwtIssuer = configService.getOrThrow('JWT_ISSUER');
    this.jwtAudience = configService.getOrThrow('JWT_AUDIENCE');
    this.jwtRefreshSecret = configService.getOrThrow('JWT_REFRESH_SECRET');
    this.bcryptRounds = configService.getOrThrow('BCRYPT_SALT_ROUNDS');
    this.cookieDomain = configService.getOrThrow('COOKIE_DOMAIN');
    this.cookieSecure = configService.getOrThrow('COOKIE_SECURE');
    this.cookieSameSite = configService.getOrThrow('COOKIE_SAME_SITE');
    this.cookieRefreshName = configService.getOrThrow('COOKIE_REFRESH_NAME');
    this.emailVerificationExpiry = configService.getOrThrow(
      'EMAIL_VERIFICATION_EXPIRY',
    );
    this.passwordResetExpiry = configService.getOrThrow(
      'PASSWORD_RESET_EXPIRY',
    );
    this.termsVersion = configService.getOrThrow('LEGAL_TERMS_VERSION');
    this.privacyVersion = configService.getOrThrow('LEGAL_PRIVACY_VERSION');
    this.webAppUrl = configService.getOrThrow('WEB_APP_URL');
    this.nodeEnv = configService.getOrThrow('NODE_ENV');
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
      const message = 'You must accept the terms of service and privacy policy';

      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: [message],
        fieldErrors: {
          ...(!dto.termsAccepted ? { termsAccepted: [message] } : {}),
          ...(!dto.privacyPolicyAccepted
            ? { privacyPolicyAccepted: [message] }
            : {}),
        },
      });
    }

    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await hash(dto.password, this.bcryptRounds);
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
      { type: UserConsentType.TermsOfService, version: this.termsVersion },
      { type: UserConsentType.PrivacyPolicy, version: this.privacyVersion },
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
    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await compare(password, user.password_hash);
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

  async loginWithGoogle(
    googleProfile: OAuthIdentityProfile,
    options: {
      preferredLanguage: string;
      termsAccepted: boolean;
      privacyPolicyAccepted: boolean;
    },
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    return this.loginWithOAuthProvider(
      googleProfile,
      options,
      res,
      ip,
      userAgent,
    );
  }

  async loginWithApple(
    appleProfile: OAuthIdentityProfile,
    options: {
      preferredLanguage: string;
      termsAccepted: boolean;
      privacyPolicyAccepted: boolean;
    },
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    return this.loginWithOAuthProvider(
      appleProfile,
      options,
      res,
      ip,
      userAgent,
    );
  }

  private async loginWithOAuthProvider(
    profile: OAuthIdentityProfile,
    options: {
      preferredLanguage: string;
      termsAccepted: boolean;
      privacyPolicyAccepted: boolean;
    },
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    const providerConfig = this.getOAuthProviderConfig(profile.provider);
    const existingProviderUser = await providerConfig.findBySubject(
      profile.providerSubject,
    );

    if (existingProviderUser) {
      const { accessToken } = await this.createSession(
        existingProviderUser,
        res,
        ip,
        userAgent,
      );
      return new AuthResponseDto(
        accessToken,
        UserResponseDto.fromEntity(existingProviderUser),
      );
    }

    const existingEmailUser = await this.usersService.findByEmail(
      profile.email,
    );

    if (existingEmailUser) {
      const linkedSubject = providerConfig.readSubject(existingEmailUser);
      if (linkedSubject && linkedSubject !== profile.providerSubject) {
        throw new ConflictException(
          `Email already linked to ${providerConfig.displayName}`,
        );
      }

      if (!profile.isEmailAuthoritative) {
        throw new ConflictException(
          `Sign in with your password before linking ${providerConfig.displayName}`,
        );
      }

      const linkedUser = await providerConfig.linkSubject(
        existingEmailUser.id,
        profile.providerSubject,
      );
      const { accessToken } = await this.createSession(
        linkedUser,
        res,
        ip,
        userAgent,
      );

      return new AuthResponseDto(
        accessToken,
        UserResponseDto.fromEntity(linkedUser),
      );
    }

    this.assertLegalConsent(
      options.termsAccepted,
      options.privacyPolicyAccepted,
    );

    const createdUser = await providerConfig.createUser({
      email: profile.email,
      subject: profile.providerSubject,
      firstName: profile.firstName,
      lastName: profile.lastName,
      preferredLanguage: normalizeLanguage(options.preferredLanguage),
    });

    await this.recordConsents(createdUser.id, ip, [
      { type: UserConsentType.TermsOfService, version: this.termsVersion },
      { type: UserConsentType.PrivacyPolicy, version: this.privacyVersion },
    ]);

    const { accessToken } = await this.createSession(
      createdUser,
      res,
      ip,
      userAgent,
    );

    return new AuthResponseDto(
      accessToken,
      UserResponseDto.fromEntity(createdUser),
    );
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
      throw new UnauthorizedException('Refresh token has been revoked');
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
    session.ip_address = sanitizeIpAddress(ip) ?? session.ip_address;
    session.user_agent = sanitizeUserAgent(userAgent) ?? session.user_agent;
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

    const passwordHash = await hash(newPassword, this.bcryptRounds);

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
  ): Promise<AccountExportData> {
    const user = await this.usersService.findByIdForAuth(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    const valid = user.password_hash
      ? await compare(password, user.password_hash)
      : false;
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
      relations: ['user'],
    });
    const activeConsentTypes = new Set(
      consents
        .filter((consent) => consent.granted && consent.revoked_at === null)
        .map((consent) => consent.consent_type),
    );

    if (skinProfile) {
      await this.dataAccessLogService.recordDataAccess(
        userId,
        getSensitiveSkinProfileConsentTypes(skinProfile),
        UserDataAccessPurpose.AccountExport,
      );
    }
    const skinJournal =
      await this.skinJournalService.exportAllDataForAccount(userId);
    const smartPicks = await this.exportSmartPicksData(userId);
    if (hasSmartPicksExportData(smartPicks)) {
      await this.dataAccessLogService.recordDataAccess(
        userId,
        [UserConsentType.AiSuggestionProcessing],
        UserDataAccessPurpose.AccountExport,
      );
    }

    return {
      user: UserResponseDto.fromEntity(user),
      skinProfile: skinProfile
        ? SkinProfileResponseDto.fromEntity(skinProfile, {
            hasHealthContextConsent: activeConsentTypes.has(
              UserConsentType.HealthContextProcessing,
            ),
            hasHormonalContextConsent: activeConsentTypes.has(
              UserConsentType.HormonalContextProcessing,
            ),
          })
        : null,
      skinJournal,
      smartPicks,
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

  private async exportSmartPicksData(
    userId: string,
  ): Promise<AccountExportSmartPicks> {
    const [snapshots, productSuggestions, actions] = await Promise.all([
      this.smartPickSnapshotRepository.find({
        where: { user_id: userId },
        order: { generated_at: 'DESC' },
      }),
      this.smartPickProductSuggestionRepository.find({
        where: { user_id: userId },
        order: { created_at: 'DESC' },
      }),
      this.suggestionGapActionRepository.find({
        where: { user_id: userId, source_type: 'smart_pick' },
        order: { created_at: 'DESC' },
      }),
    ]);

    return {
      snapshots: snapshots.map((snapshot) => ({
        mode: snapshot.mode,
        coverage: snapshot.coverage_json,
        gaps: snapshot.gaps_json,
        covered: snapshot.covered_json,
        redundancy: snapshot.redundancy_json,
        recap: snapshot.recap_json,
        inputsHash: snapshot.inputs_hash,
        generatedAt: toIsoString(snapshot.generated_at),
      })),
      productSuggestions: productSuggestions.map((suggestion) => ({
        ingredientOrCategory: suggestion.ingredient_or_category,
        normalizedKey: suggestion.normalized_key,
        brand: suggestion.brand,
        productName: suggestion.product_name,
        budgetTier: suggestion.budget_tier,
        sellerNames: suggestion.seller_names_json,
        recommendationRankReason: suggestion.recommendation_rank_reason,
        sourceIds: suggestion.source_ids,
        gapReason: suggestion.gap_reason,
        goalAlignment: suggestion.goal_alignment,
        createdAt: toIsoString(suggestion.created_at),
        updatedAt: toIsoString(suggestion.updated_at),
      })),
      actions: actions.map((action) => ({
        sourceType: action.source_type,
        ingredientOrCategory: action.ingredient_or_category,
        normalizedKey: action.normalized_key,
        action: action.action,
        createdAt: toIsoString(action.created_at),
        updatedAt: toIsoString(action.updated_at),
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

    const valid = user.password_hash
      ? await compare(password, user.password_hash)
      : false;
    if (!valid) {
      throw new UnauthorizedException('Invalid password');
    }

    await this.skinJournalService.deleteAllMediaForUser(userId);
    await this.usersService.remove(userId);
    this.clearRefreshCookie(res);
  }

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
      user_agent: sanitizeUserAgent(userAgent),
      ip_address: sanitizeIpAddress(ip),
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
    res.cookie(
      this.cookieRefreshName,
      token,
      this.getRefreshCookieOptions(this.parseExpiryMs(this.jwtRefreshExpiry)),
    );
  }

  clearRefreshCookie(res: Response): void {
    res.clearCookie(this.cookieRefreshName, this.getRefreshCookieOptions());
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
    consents: { type: UserConsentType; version: string }[],
  ): Promise<void> {
    const now = nowDate();
    const sanitizedIp = sanitizeIpAddress(ip);
    const entities = consents.map((c) =>
      this.consentsRepository.create({
        id: ulid(),
        user_id: userId,
        consent_type: c.type,
        consent_version: c.version,
        granted: true,
        granted_at: now,
        ip_address: sanitizedIp,
      }),
    );
    await this.consentsRepository.save(entities);
  }

  private assertLegalConsent(
    termsAccepted: boolean,
    privacyPolicyAccepted: boolean,
  ): void {
    if (termsAccepted && privacyPolicyAccepted) {
      return;
    }

    const message = 'You must accept the terms of service and privacy policy';

    throw new BadRequestException({
      statusCode: HttpStatus.BAD_REQUEST,
      message: [message],
      fieldErrors: {
        ...(!termsAccepted ? { termsAccepted: [message] } : {}),
        ...(!privacyPolicyAccepted ? { privacyPolicyAccepted: [message] } : {}),
      },
    });
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
      const deliveryError =
        error instanceof Error
          ? error
          : new Error('Email delivery failed with a non-Error value');
      this.logEmailDeliveryFailure(
        'verification',
        email,
        this.buildFrontendPathActionUrl('verify-email', token),
        deliveryError,
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
      const deliveryError =
        error instanceof Error
          ? error
          : new Error('Email delivery failed with a non-Error value');
      this.logEmailDeliveryFailure(
        'password reset',
        email,
        this.buildFrontendPathActionUrl('reset-password', token),
        deliveryError,
      );
    }
  }

  private logEmailDeliveryFailure(
    type: 'verification' | 'password reset',
    email: string,
    actionUrl: string,
    error: Error,
  ): void {
    const message = error.message;
    const stack = error.stack;

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

  private getOAuthProviderConfig(provider: OAuthProvider): OAuthProviderConfig {
    if (provider === OAuthProvider.Apple) {
      return {
        displayName: 'Apple',
        findBySubject: (subject) =>
          this.usersService.findByAppleSubject(subject),
        readSubject: (user) => user.apple_subject,
        linkSubject: (id, subject) =>
          this.usersService.linkAppleSubject(id, subject),
        createUser: (data) =>
          this.usersService.createAppleUser({
            email: data.email,
            apple_subject: data.subject,
            first_name: data.firstName,
            last_name: data.lastName,
            preferred_language: data.preferredLanguage,
          }),
      };
    }

    if (provider === OAuthProvider.Google) {
      return {
        displayName: 'Google',
        findBySubject: (subject) =>
          this.usersService.findByGoogleSubject(subject),
        readSubject: (user) => user.google_subject,
        linkSubject: (id, subject) =>
          this.usersService.linkGoogleSubject(id, subject),
        createUser: (data) =>
          this.usersService.createGoogleUser({
            email: data.email,
            google_subject: data.subject,
            first_name: data.firstName,
            last_name: data.lastName,
            preferred_language: data.preferredLanguage,
          }),
      };
    }

    throw new UnauthorizedException('Unsupported OAuth provider');
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

  private getRefreshCookieOptions(maxAge?: number): {
    domain?: string;
    httpOnly: boolean;
    maxAge?: number;
    path: string;
    sameSite: 'lax' | 'strict' | 'none';
    secure: boolean;
  } {
    const cookieOptions: {
      domain?: string;
      httpOnly: boolean;
      maxAge?: number;
      path: string;
      sameSite: 'lax' | 'strict' | 'none';
      secure: boolean;
    } = {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/api/v1/auth',
    };

    if (maxAge !== undefined) {
      cookieOptions.maxAge = maxAge;
    }

    if (this.cookieDomain) {
      cookieOptions.domain = this.cookieDomain;
    }

    return cookieOptions;
  }
}

function hasSmartPicksExportData(data: AccountExportSmartPicks): boolean {
  return (
    data.snapshots.length > 0 ||
    data.productSuggestions.length > 0 ||
    data.actions.length > 0
  );
}
