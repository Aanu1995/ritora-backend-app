import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
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
import { CataloguePhotoStorageService } from '../catalogue/catalogue-photo-storage.service';
import {
  expiresFromDuration,
  isAfterNow,
  isBeforeNow,
  nowDate,
  toIsoString,
  toNullableIsoString,
} from '../common/utils/date';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
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
import { AccountDeletionSchedulerService } from './account-deletion-scheduler.service';
import { AccountDeletionStatus } from './dto/account-deletion-response.dto';
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

type AccountDeletionResult = {
  status: AccountDeletionStatus;
  scheduledFor?: string;
};

type AccountDeletionScheduleOptions = {
  confirmTokenHash?: string | null;
  confirmExpires?: Date | null;
};

const ACCOUNT_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const ACCOUNT_DELETION_CONFIRM_EXPIRY = '1h';
const ACCOUNT_DELETION_BATCH_SIZE = 100;
const ACCOUNT_DELETION_CANCEL_IDEMPOTENCY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ACCOUNT_DELETION_EXTERNAL_TIMEOUT_MS = 10_000;
const ACCOUNT_DELETION_EXTERNAL_TIMEOUT_CONFIG_KEY =
  'ACCOUNT_DELETION_EXTERNAL_TIMEOUT_MS';

function roundUpToWholeSecond(value: Date): Date {
  const timestamp = value.getTime();
  const millisecondRemainder = timestamp % 1000;
  if (millisecondRemainder === 0) {
    return value;
  }

  return new Date(timestamp + (1000 - millisecondRemainder));
}

function readPositiveMilliseconds(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

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
  private readonly accountDeletionExternalTimeoutMs: number;

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
    @InjectRepository(InventoryProduct)
    private readonly inventoryProductRepository: Repository<InventoryProduct>,
    private readonly dataAccessLogService: UserDataAccessLogService,
    private readonly skinJournalService: SkinJournalService,
    private readonly cataloguePhotoStorageService: CataloguePhotoStorageService,
    private readonly accountDeletionScheduler: AccountDeletionSchedulerService,
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
    this.accountDeletionExternalTimeoutMs = readPositiveMilliseconds(
      configService.get(ACCOUNT_DELETION_EXTERNAL_TIMEOUT_CONFIG_KEY),
      DEFAULT_ACCOUNT_DELETION_EXTERNAL_TIMEOUT_MS,
    );
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

    this.assertUserNotRestricted(user);

    if (!user.email_verified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email not verified',
      });
    }

    await this.cancelAccountDeletionOnAccess(user);

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
      this.assertUserNotRestricted(existingProviderUser);
      await this.cancelAccountDeletionOnAccess(existingProviderUser);
      const authUser =
        (await this.usersService.findByIdForAuth(existingProviderUser.id)) ??
        existingProviderUser;
      const { accessToken } = await this.createSession(
        existingProviderUser,
        res,
        ip,
        userAgent,
      );
      return new AuthResponseDto(
        accessToken,
        UserResponseDto.fromEntity(
          existingProviderUser,
          Boolean(authUser.password_hash),
        ),
      );
    }

    const existingEmailUser = await this.usersService.findByEmail(
      profile.email,
    );

    if (existingEmailUser) {
      this.assertUserNotRestricted(existingEmailUser);
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
      await this.cancelAccountDeletionOnAccess(linkedUser);
      const authUser =
        (await this.usersService.findByIdForAuth(linkedUser.id)) ?? linkedUser;
      const { accessToken } = await this.createSession(
        linkedUser,
        res,
        ip,
        userAgent,
      );

      return new AuthResponseDto(
        accessToken,
        UserResponseDto.fromEntity(linkedUser, Boolean(authUser.password_hash)),
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

    this.assertUserNotRestricted(session.user);

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
    const user = await this.usersService.findByIdForAuth(userId);
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
    language: AppLanguage = 'en',
  ): Promise<AccountDeletionResult> {
    const user = await this.usersService.findByIdForAuth(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    if (!user.password_hash) {
      const result = await this.requestOAuthAccountDeletionConfirmation(
        user,
        language,
      );
      await this.revokeAllSessions(user.id);
      this.clearRefreshCookie(res);
      return result;
    }

    const valid = await compare(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid password');
    }

    const result = await this.scheduleAccountDeletion(user, language);
    await this.revokeAllSessions(user.id);
    this.clearRefreshCookie(res);
    return result;
  }

  async confirmAccountDeletion(
    token: string,
    language?: string,
  ): Promise<AccountDeletionResult> {
    const tokenHash = this.sha256(token);
    const user =
      await this.usersService.findByAccountDeletionConfirmTokenHash(tokenHash);

    if (!user) {
      throw new BadRequestException('Invalid account deletion token');
    }

    if (user.account_deletion_scheduled_for) {
      if (!isAfterNow(user.account_deletion_scheduled_for)) {
        throw new BadRequestException('Account deletion token has expired');
      }

      return {
        status: AccountDeletionStatus.Scheduled,
        scheduledFor: toIsoString(user.account_deletion_scheduled_for),
      };
    }

    const confirmExpires = user.account_deletion_confirm_expires;
    if (!confirmExpires) {
      throw new BadRequestException('Invalid account deletion token');
    }

    if (isBeforeNow(confirmExpires)) {
      await this.usersService.clearAccountDeletionState(user.id);
      throw new BadRequestException('Account deletion token has expired');
    }

    const result = await this.scheduleAccountDeletion(
      user,
      normalizeLanguage(language),
      {
        confirmTokenHash: tokenHash,
        confirmExpires,
      },
    );
    await this.revokeAllSessions(user.id);
    return result;
  }

  async cancelAccountDeletion(token: string, language?: string): Promise<void> {
    const tokenHash = this.sha256(token);
    const user =
      await this.usersService.findByAccountDeletionCancelTokenHash(tokenHash);

    if (!user) {
      throw new BadRequestException('Invalid account deletion token');
    }

    if (!user.account_deletion_scheduled_for) {
      if (this.isRecentAccountDeletionCancellation(user)) {
        return;
      }
      throw new BadRequestException('Invalid account deletion token');
    }

    if (!isAfterNow(user.account_deletion_scheduled_for)) {
      throw new BadRequestException('Account deletion token has expired');
    }

    await this.cancelAccountDeletionForUser(
      user,
      normalizeLanguage(language),
      tokenHash,
    );
  }

  async processDueAccountDeletions(
    now: Date = nowDate(),
    take = ACCOUNT_DELETION_BATCH_SIZE,
  ): Promise<number> {
    const users = await this.usersService.findDueAccountDeletions(now, take);
    let deleted = 0;

    for (const user of users) {
      try {
        if (!user.account_deletion_scheduled_for) {
          continue;
        }
        const wasDeleted = await this.processScheduledAccountDeletion(
          user.id,
          user.account_deletion_scheduled_for,
          now,
        );
        if (wasDeleted) deleted += 1;
      } catch (error) {
        this.logger.error(
          `Failed to finalize scheduled account deletion for user ${user.id}`,
          error,
        );
      }
    }

    return deleted;
  }

  async clearExpiredAccountDeletionCancellationReceipts(
    now: Date = nowDate(),
  ): Promise<number> {
    return this.usersService.clearExpiredAccountDeletionCancellationReceipts(
      new Date(now.getTime() - ACCOUNT_DELETION_CANCEL_IDEMPOTENCY_MS),
    );
  }

  async processScheduledAccountDeletion(
    userId: string,
    scheduledFor: Date,
    now: Date = nowDate(),
  ): Promise<boolean> {
    const current = await this.usersService.findById(userId);
    const currentScheduledFor = current?.account_deletion_scheduled_for;
    if (!currentScheduledFor) {
      return false;
    }

    if (currentScheduledFor.getTime() !== scheduledFor.getTime()) {
      return false;
    }

    if (currentScheduledFor.getTime() > now.getTime()) {
      return false;
    }

    await this.finalizeAccountDeletion(current.id);
    return true;
  }

  private async requestOAuthAccountDeletionConfirmation(
    user: User,
    language: AppLanguage,
  ): Promise<AccountDeletionResult> {
    const confirmToken = randomBytes(32).toString('hex');
    const now = nowDate();

    await this.usersService.setAccountDeletionState(user.id, {
      requestedAt: now,
      scheduledFor: null,
      cancelTokenHash: null,
      confirmTokenHash: this.sha256(confirmToken),
      confirmExpires: expiresFromDuration(ACCOUNT_DELETION_CONFIRM_EXPIRY),
    });

    await this.sendAccountDeletionConfirmationEmailOrFail(
      user,
      confirmToken,
      language,
    );

    return { status: AccountDeletionStatus.ConfirmationRequired };
  }

  private async scheduleAccountDeletion(
    user: User,
    language: AppLanguage,
    options: AccountDeletionScheduleOptions = {},
  ): Promise<AccountDeletionResult> {
    const cancelToken = randomBytes(32).toString('hex');
    const requestedAt = nowDate();
    const scheduledFor = roundUpToWholeSecond(
      new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_MS),
    );
    const scheduledForIso = toIsoString(scheduledFor);

    await this.usersService.setAccountDeletionState(user.id, {
      requestedAt,
      scheduledFor,
      cancelTokenHash: this.sha256(cancelToken),
      confirmTokenHash: options.confirmTokenHash ?? null,
      confirmExpires: options.confirmExpires ?? null,
    });

    try {
      await this.runAccountDeletionExternalOperation(
        this.accountDeletionScheduler.scheduleFinalization(
          user.id,
          scheduledFor,
        ),
        'Account deletion finalization scheduling timed out',
      );
    } catch (error) {
      await this.usersService.clearAccountDeletionState(user.id);
      void this.cancelDurableAccountDeletionSchedule(user.id);
      this.logger.error(
        `Failed to create durable account deletion schedule for user ${user.id}`,
        error,
      );
      throw new InternalServerErrorException(
        'Account deletion could not be scheduled',
      );
    }

    await this.sendAccountDeletionScheduledEmailOrRollback(
      user,
      cancelToken,
      language,
      scheduledForIso,
    );

    return {
      status: AccountDeletionStatus.Scheduled,
      scheduledFor: scheduledForIso,
    };
  }

  private async cancelAccountDeletionOnAccess(user: User): Promise<void> {
    if (!user.account_deletion_scheduled_for) {
      await this.usersService.clearAccountDeletionState(user.id);
      return;
    }

    if (!isAfterNow(user.account_deletion_scheduled_for)) {
      await this.finalizeAccountDeletion(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.cancelAccountDeletionForUser(
      user,
      normalizeLanguage(user.preferred_language),
    );
  }

  private async cancelAccountDeletionForUser(
    user: User,
    language: AppLanguage,
    cancelTokenHash?: string,
  ): Promise<void> {
    if (cancelTokenHash) {
      const didCancel =
        await this.usersService.markAccountDeletionCancellationComplete(
          user.id,
          cancelTokenHash,
          nowDate(),
        );

      if (!didCancel) {
        return;
      }
    } else {
      await this.usersService.clearAccountDeletionState(user.id);
    }
    // The database state is the source of truth; external cleanup must not keep
    // the cancellation request open after the account is already safe.
    void this.cancelDurableAccountDeletionSchedule(user.id);
    void this.sendAccountDeletionCancelledEmailOrLogFailure(user, language);
  }

  private isRecentAccountDeletionCancellation(user: User): boolean {
    if (!user.account_deletion_cancel_token_consumed_at) {
      return false;
    }

    const consumedAt = user.account_deletion_cancel_token_consumed_at.getTime();
    return (
      nowDate().getTime() - consumedAt <= ACCOUNT_DELETION_CANCEL_IDEMPOTENCY_MS
    );
  }

  private async cancelDurableAccountDeletionSchedule(
    userId: string,
  ): Promise<void> {
    try {
      await this.runAccountDeletionExternalOperation(
        this.accountDeletionScheduler.cancelFinalization(userId),
        'Account deletion finalization cancellation timed out',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to cancel durable account deletion schedule for user ${userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async finalizeAccountDeletion(userId: string): Promise<void> {
    const products = await this.inventoryProductRepository.find({
      where: { user_id: userId },
    });
    const imageUrls = products.flatMap((product) =>
      Array.isArray(product.identity.imageUrls)
        ? product.identity.imageUrls.filter(
            (imageUrl): imageUrl is string => typeof imageUrl === 'string',
          )
        : [],
    );

    await this.cataloguePhotoStorageService.deleteManagedImageUrls(imageUrls);
    await this.cataloguePhotoStorageService.deleteManagedImagesForOwner(userId);
    await this.skinJournalService.deleteAllMediaForUser(userId);
    await this.usersService.remove(userId);
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

  private assertUserNotRestricted(user: User): void {
    if (user.account_restricted_at) {
      throw new ForbiddenException({
        code: 'ACCOUNT_RESTRICTED',
        message: 'Account restricted',
      });
    }
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

  private async sendAccountDeletionConfirmationEmailOrFail(
    user: User,
    token: string,
    language: AppLanguage,
  ): Promise<void> {
    try {
      await this.runAccountDeletionExternalOperation(
        this.mailService.sendAccountDeletionConfirmationEmail(
          user.email,
          token,
          user.first_name,
          language,
        ),
        'Account deletion confirmation email timed out',
      );
    } catch (error) {
      this.logAccountDeletionEmailFailure(
        'account deletion confirmation',
        user.email,
        error,
      );
      await this.usersService.clearAccountDeletionState(user.id);
      throw new InternalServerErrorException(
        'Account deletion email could not be sent',
      );
    }
  }

  private async sendAccountDeletionScheduledEmailOrRollback(
    user: User,
    token: string,
    language: AppLanguage,
    scheduledFor: string,
  ): Promise<void> {
    try {
      await this.runAccountDeletionExternalOperation(
        this.mailService.sendAccountDeletionScheduledEmail(
          user.email,
          token,
          user.first_name,
          language,
          scheduledFor,
        ),
        'Account deletion scheduled email timed out',
      );
    } catch (error) {
      this.logAccountDeletionEmailFailure(
        'account deletion scheduled',
        user.email,
        error,
      );
      await this.usersService.clearAccountDeletionState(user.id);
      void this.cancelDurableAccountDeletionSchedule(user.id);
      throw new InternalServerErrorException(
        'Account deletion email could not be sent',
      );
    }
  }

  private async sendAccountDeletionCancelledEmailOrLogFailure(
    user: User,
    language: AppLanguage,
  ): Promise<void> {
    try {
      await this.mailService.sendAccountDeletionCancelledEmail(
        user.email,
        user.first_name,
        language,
      );
    } catch (error) {
      this.logAccountDeletionEmailFailure(
        'account deletion cancellation',
        user.email,
        error,
      );
    }
  }

  private async runAccountDeletionExternalOperation<T>(
    operation: Promise<T>,
    timeoutMessage: string,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, this.accountDeletionExternalTimeoutMs);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private logAccountDeletionEmailFailure(
    type:
      | 'account deletion confirmation'
      | 'account deletion scheduled'
      | 'account deletion cancellation',
    email: string,
    error: unknown,
  ): void {
    const deliveryError =
      error instanceof Error
        ? error
        : new Error('Email delivery failed with a non-Error value');
    this.logEmailDeliveryFailure(type, email, null, deliveryError);
  }

  private logEmailDeliveryFailure(
    type:
      | 'verification'
      | 'password reset'
      | 'account deletion confirmation'
      | 'account deletion scheduled'
      | 'account deletion cancellation',
    email: string,
    actionUrl: string | null,
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

    const actionUrlMessage = actionUrl
      ? `Temporary ${type} URL for ${email}: ${actionUrl}`
      : `Temporary ${type} URL for ${email}: account deletion action URL withheld because it contains a one-time token.`;

    this.logger.warn(
      `${MAIL_PROVIDER_LABEL} delivery failed in development. Check your RESEND_API_KEY and verified MAIL_FROM address. ${actionUrlMessage}`,
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
