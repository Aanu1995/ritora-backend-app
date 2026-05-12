import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { nowDate } from '../common/utils/date';
import { SmartPicksPreparationService } from '../smart-picks/services/smart-picks-preparation.service';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UserDataAccessLog } from '../users/entities/user-data-access-log.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessActorType,
  UserDataAccessEventType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { UsersService } from '../users/users.service';
import { CreateSkinProfileDto } from './dto/create-skin-profile.dto';
import {
  ACTIVE_INGREDIENT_KEYS,
  ACTIVE_TOLERANCE_LEVELS,
  SKIN_PROFILE_ERROR_CODES,
  SkinProfileSexAtBirth,
} from './dto/skin-profile.constants';
import { UpdateSkinProfileDto } from './dto/update-skin-profile.dto';
import { SkinProfile } from './entities/skin-profile.entity';
import {
  computeSkinProfileCompleteness,
  isHormonalContextApplicable,
} from './skin-profile-completion';
import {
  getSensitiveSkinProfileConsentTypes,
  hasSkinProfileHealthContextData,
  hasSkinProfileHormonalContextData,
} from './skin-profile-sensitive-data';

const MIN_BIRTH_AGE_YEARS = 5;
const MAX_BIRTH_AGE_YEARS = 80;
const ACTIVE_INGREDIENT_KEY_SET = new Set<string>(ACTIVE_INGREDIENT_KEYS);
const ACTIVE_TOLERANCE_LEVEL_SET = new Set<string>(ACTIVE_TOLERANCE_LEVELS);
const ACTIVE_TOLERANCE_KEYS = new Set(['tolerance', 'last_used']);

type FindSkinProfileOptions = {
  recordSensitiveAccess?: boolean;
  accessPurpose?: UserDataAccessPurpose;
  actorType?: UserDataAccessActorType;
};

@Injectable()
export class SkinProfileService {
  private readonly privacyVersion: string;

  constructor(
    @InjectRepository(SkinProfile)
    private readonly profileRepository: Repository<SkinProfile>,
    @InjectRepository(UserConsent)
    private readonly consentsRepository: Repository<UserConsent>,
    private readonly usersService: UsersService,
    private readonly dataAccessLogService: UserDataAccessLogService,
    configService: ConfigService,
    @Optional()
    private readonly smartPicksPreparation?: SmartPicksPreparationService,
  ) {
    this.privacyVersion = configService.getOrThrow('LEGAL_PRIVACY_VERSION');
  }

  async findByUserId(
    userId: string,
    options: FindSkinProfileOptions = {},
  ): Promise<SkinProfile | null> {
    const profile = await this.profileRepository.findOne({
      where: { user_id: userId },
      relations: ['user'],
    });

    if (profile && options.recordSensitiveAccess) {
      await this.dataAccessLogService.recordDataAccess(
        userId,
        getSensitiveSkinProfileConsentTypes(profile),
        options.accessPurpose ?? UserDataAccessPurpose.SkinProfileRead,
        options.actorType ?? UserDataAccessActorType.User,
      );
    }

    return profile;
  }

  async listDataAccessLogs(userId: string): Promise<UserDataAccessLog[]> {
    return this.dataAccessLogService.listForUser(userId);
  }

  async create(
    userId: string,
    dto: CreateSkinProfileDto,
  ): Promise<SkinProfile> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.email_verified) {
      throw new ForbiddenException(
        'Email must be verified to create a skin profile',
      );
    }

    const existing = await this.findByUserId(userId);
    if (existing) {
      throw new ConflictException('Skin profile already exists');
    }

    this.assertEssentialCreatePayload(dto);
    this.assertDateOfBirthInAllowedRange(dto.dateOfBirth as string);
    this.assertActiveTolerancesPayload(dto);
    this.assertHormonalContextApplicable(dto);
    await this.ensureLocationConsent(userId, dto);
    await this.ensureHealthContextConsent(userId, dto);
    await this.ensureHormonalContextConsent(userId, dto);
    await this.syncUserProfileFields(userId, dto);
    user.date_of_birth = dto.dateOfBirth ?? user.date_of_birth ?? null;
    user.sex_at_birth = dto.sexAtBirth ?? user.sex_at_birth ?? null;

    const profile = this.profileRepository.create({
      user_id: userId,
      user,
      skin_type: dto.skinType ?? null,
      skin_tone: dto.skinTone ?? null,
      ethnicity: dto.ethnicity ?? null,
      current_concerns: dto.currentConcerns ?? [],
      country_code: dto.countryCode ?? null,
      city: dto.city ?? null,
      fitzpatrick_phototype: dto.fitzpatrickPhototype ?? null,
      sensitivity_level: dto.sensitivityLevel ?? null,
      hydration_level: dto.hydrationLevel ?? null,
      primary_goal: dto.primaryGoal ?? null,
      pregnancy_status: dto.pregnancyStatus ?? null,
      under_dermatologist_care: dto.underDermatologistCare ?? null,
      allow_smart_picks: dto.allowSmartPicks ?? true,
      budget_tier: dto.budgetTier ?? null,
      safety_context: dto.safetyContext ?? {},
      reaction_history: dto.reactionHistory ?? {},
      concern_details: dto.concernDetails ?? {},
      skin_behavior: dto.skinBehavior ?? {},
      active_tolerances: dto.activeTolerances ?? {},
      routine_preferences: dto.routinePreferences ?? {},
      lifestyle_context: dto.lifestyleContext ?? {},
      shopping_preferences: dto.shoppingPreferences ?? {},
      hormonal_context:
        this.resolveSexAtBirth(dto) === SkinProfileSexAtBirth.Male
          ? {}
          : (dto.hormonalContext ?? {}),
    });

    const savedProfile = await this.profileRepository.save(profile);
    await this.syncLocationConsent(
      userId,
      this.hasLocationData(savedProfile.country_code, savedProfile.city),
      dto.locationConsent,
    );
    await this.syncHealthContextConsent(
      userId,
      this.hasHealthContextData(savedProfile),
    );
    await this.syncHormonalContextConsent(
      userId,
      this.hasHormonalContextData(savedProfile),
    );
    this.scheduleSmartPicksPreparation(userId);

    return savedProfile;
  }

  async update(
    userId: string,
    dto: UpdateSkinProfileDto,
  ): Promise<SkinProfile> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Skin profile not found');
    }

    if (dto.dateOfBirth !== undefined && dto.dateOfBirth !== null) {
      this.assertDateOfBirthInAllowedRange(dto.dateOfBirth);
    }
    this.assertActiveTolerancesPayload(dto);
    this.assertHormonalContextApplicable(dto, profile);
    const nextSexAtBirth = this.resolveSexAtBirth(dto, profile);

    await this.ensureLocationConsent(userId, dto, profile);
    await this.ensureHealthContextConsent(userId, dto, profile);
    await this.ensureHormonalContextConsent(userId, dto, profile);

    await this.syncUserProfileFields(userId, dto);
    if (profile.user) {
      if (dto.dateOfBirth !== undefined) {
        profile.user.date_of_birth = dto.dateOfBirth ?? null;
      }
      if (dto.sexAtBirth !== undefined) {
        profile.user.sex_at_birth = dto.sexAtBirth ?? null;
      }
    }

    if (dto.skinType !== undefined) profile.skin_type = dto.skinType ?? null;
    if (dto.skinTone !== undefined) profile.skin_tone = dto.skinTone ?? null;
    if (dto.ethnicity !== undefined) profile.ethnicity = dto.ethnicity ?? null;
    if (dto.currentConcerns !== undefined)
      profile.current_concerns = dto.currentConcerns;
    if (dto.countryCode !== undefined)
      profile.country_code = dto.countryCode ?? null;
    if (dto.city !== undefined) profile.city = dto.city ?? null;
    if (dto.fitzpatrickPhototype !== undefined)
      profile.fitzpatrick_phototype = dto.fitzpatrickPhototype ?? null;
    if (dto.sensitivityLevel !== undefined)
      profile.sensitivity_level = dto.sensitivityLevel ?? null;
    if (dto.hydrationLevel !== undefined)
      profile.hydration_level = dto.hydrationLevel ?? null;
    if (dto.primaryGoal !== undefined)
      profile.primary_goal = dto.primaryGoal ?? null;
    if (dto.pregnancyStatus !== undefined)
      profile.pregnancy_status = dto.pregnancyStatus ?? null;
    if (dto.underDermatologistCare !== undefined)
      profile.under_dermatologist_care = dto.underDermatologistCare ?? null;
    if (dto.allowSmartPicks !== undefined)
      profile.allow_smart_picks = dto.allowSmartPicks;
    if (dto.budgetTier !== undefined)
      profile.budget_tier = dto.budgetTier ?? null;
    if (dto.safetyContext !== undefined)
      profile.safety_context = dto.safetyContext ?? {};
    if (dto.reactionHistory !== undefined)
      profile.reaction_history = dto.reactionHistory ?? {};
    if (dto.concernDetails !== undefined)
      profile.concern_details = dto.concernDetails ?? {};
    if (dto.skinBehavior !== undefined)
      profile.skin_behavior = dto.skinBehavior ?? {};
    if (dto.activeTolerances !== undefined)
      profile.active_tolerances = dto.activeTolerances ?? {};
    if (dto.routinePreferences !== undefined)
      profile.routine_preferences = dto.routinePreferences ?? {};
    if (dto.lifestyleContext !== undefined)
      profile.lifestyle_context = dto.lifestyleContext ?? {};
    if (dto.shoppingPreferences !== undefined)
      profile.shopping_preferences = dto.shoppingPreferences ?? {};
    if (nextSexAtBirth === SkinProfileSexAtBirth.Male) {
      profile.hormonal_context = {};
    } else if (dto.hormonalContext !== undefined) {
      profile.hormonal_context = dto.hormonalContext ?? {};
    }

    const savedProfile = await this.profileRepository.save(profile);
    await this.syncLocationConsent(
      userId,
      this.hasLocationData(savedProfile.country_code, savedProfile.city),
      dto.locationConsent,
    );
    await this.syncHealthContextConsent(
      userId,
      this.hasHealthContextData(savedProfile),
    );
    await this.syncHormonalContextConsent(
      userId,
      this.hasHormonalContextData(savedProfile),
    );
    this.scheduleSmartPicksPreparation(userId);

    return savedProfile;
  }

  async remove(userId: string): Promise<void> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Skin profile not found');
    }
    await this.profileRepository.remove(profile);
    await this.syncLocationConsent(userId, false, false);
    await this.syncHealthContextConsent(userId, false);
    await this.syncHormonalContextConsent(userId, false);
    this.scheduleSmartPicksPreparation(userId);
  }

  async clearHealthContext(userId: string): Promise<SkinProfile> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Skin profile not found');
    }

    profile.pregnancy_status = null;
    profile.under_dermatologist_care = null;
    profile.safety_context = {};

    const savedProfile = await this.profileRepository.save(profile);
    await this.syncHealthContextConsent(userId, false);
    this.scheduleSmartPicksPreparation(userId);
    return savedProfile;
  }

  async clearHormonalContext(userId: string): Promise<SkinProfile> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Skin profile not found');
    }

    profile.hormonal_context = {};

    const savedProfile = await this.profileRepository.save(profile);
    await this.syncHormonalContextConsent(userId, false);
    this.scheduleSmartPicksPreparation(userId);
    return savedProfile;
  }

  private scheduleSmartPicksPreparation(userId: string): void {
    this.smartPicksPreparation?.scheduleForUser(userId);
  }

  async hasActiveHealthContextConsent(userId: string): Promise<boolean> {
    return Boolean(await this.findActiveHealthContextConsent(userId));
  }

  async hasActiveLocationContextConsent(userId: string): Promise<boolean> {
    return Boolean(await this.findActiveLocationConsent(userId));
  }

  async hasActiveHormonalContextConsent(userId: string): Promise<boolean> {
    return Boolean(await this.findActiveHormonalContextConsent(userId));
  }

  computeCompleteness(profile: SkinProfile): number {
    return computeSkinProfileCompleteness(profile);
  }

  private hasLocationData(
    countryCode: string | null | undefined,
    city: string | null | undefined,
  ): boolean {
    return Boolean(countryCode?.trim() || city?.trim());
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private assertActiveTolerancesPayload(
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
  ): void {
    if (dto.activeTolerances === undefined || dto.activeTolerances === null) {
      return;
    }

    if (!this.isRecord(dto.activeTolerances)) {
      this.throwInvalidActiveTolerances();
    }

    const entries = Object.entries(dto.activeTolerances);
    if (entries.length > ACTIVE_INGREDIENT_KEYS.length) {
      this.throwInvalidActiveTolerances();
    }

    for (const [ingredient, value] of entries) {
      if (!ACTIVE_INGREDIENT_KEY_SET.has(ingredient) || !this.isRecord(value)) {
        this.throwInvalidActiveTolerances();
      }

      if (
        Object.keys(value).some((key) => !ACTIVE_TOLERANCE_KEYS.has(key)) ||
        typeof value.tolerance !== 'string' ||
        !ACTIVE_TOLERANCE_LEVEL_SET.has(value.tolerance)
      ) {
        this.throwInvalidActiveTolerances();
      }

      if (
        value.last_used !== undefined &&
        value.last_used !== null &&
        (typeof value.last_used !== 'string' ||
          !this.isValidOptionalDate(value.last_used))
      ) {
        this.throwInvalidActiveTolerances();
      }
    }
  }

  private isValidOptionalDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const [year, month, day] = value.split('-').map(Number);
    const parsedDate = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsedDate.getTime()) &&
      parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() + 1 === month &&
      parsedDate.getUTCDate() === day
    );
  }

  private throwInvalidActiveTolerances(): never {
    throw new BadRequestException({
      code: SKIN_PROFILE_ERROR_CODES.InvalidActiveTolerances,
      message:
        'Active tolerances must use known ingredients and tolerance levels',
    });
  }

  private hasHealthContextData(profile: SkinProfile): boolean {
    return hasSkinProfileHealthContextData(profile);
  }

  private hasHormonalContextData(profile: SkinProfile): boolean {
    if (!this.isHormonalContextApplicable(profile)) {
      return false;
    }

    return hasSkinProfileHormonalContextData(profile);
  }

  private isHormonalContextApplicable(profile: SkinProfile): boolean {
    return isHormonalContextApplicable(profile);
  }

  private resolveSexAtBirth(
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
    existingProfile?: SkinProfile,
  ): string | null {
    if (dto.sexAtBirth !== undefined) {
      return dto.sexAtBirth ?? null;
    }

    return existingProfile?.user?.sex_at_birth ?? null;
  }

  private assertHormonalContextApplicable(
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
    existingProfile?: SkinProfile,
  ): void {
    if (
      this.resolveSexAtBirth(dto, existingProfile) !==
        SkinProfileSexAtBirth.Male ||
      Object.keys(dto.hormonalContext ?? {}).length === 0
    ) {
      return;
    }

    throw new BadRequestException({
      code: SKIN_PROFILE_ERROR_CODES.HormonalContextNotApplicable,
      message: 'Hormonal context is not applicable when sex at birth is male',
    });
  }

  private assertEssentialCreatePayload(dto: CreateSkinProfileDto): void {
    const routine = dto.routinePreferences ?? {};
    const behavior = dto.skinBehavior ?? {};
    const lifestyle = dto.lifestyleContext ?? {};
    const concernDetails = dto.concernDetails?.per_concern ?? [];
    const hasConcernSeverity = (dto.currentConcerns ?? []).every((concern) =>
      concernDetails.some(
        (entry) => entry.concern === concern && entry.severity,
      ),
    );
    const missing = [
      dto.skinType,
      dto.skinTone,
      dto.fitzpatrickPhototype,
      dto.dateOfBirth,
      dto.sexAtBirth,
      dto.ethnicity,
      dto.currentConcerns?.length ? 'currentConcerns' : null,
      dto.primaryGoal,
      hasConcernSeverity ? 'concernSeverity' : null,
      behavior.pih_tendency,
      behavior.melasma_tendency,
      behavior.keloid_tendency,
      behavior.sunscreen_habit,
      behavior.sunscreen_tolerance,
      routine.pace,
      routine.fragrance_free == null ? null : 'fragranceFree',
      routine.non_comedogenic == null ? null : 'nonComedogenic',
      routine.sunscreen_filter,
      routine.sunscreen_finish,
      lifestyle.water_hardness,
      lifestyle.water_sensitivity,
      dto.budgetTier,
      dto.allowSmartPicks == null ? null : 'allowSmartPicks',
    ].filter((value) => !value);

    if (missing.length === 0) {
      return;
    }

    throw new BadRequestException({
      code: SKIN_PROFILE_ERROR_CODES.EssentialsRequired,
      message: 'All essential skin profile fields are required',
    });
  }

  private assertDateOfBirthInAllowedRange(dateOfBirth: string): void {
    const parsedDate = new Date(`${dateOfBirth}T00:00:00.000Z`);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException({
        code: SKIN_PROFILE_ERROR_CODES.EssentialsRequired,
        message: 'Date of birth must be a valid date',
      });
    }

    const today = new Date();
    const todayUtc = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const youngestAllowed = new Date(todayUtc);
    youngestAllowed.setUTCFullYear(
      youngestAllowed.getUTCFullYear() - MIN_BIRTH_AGE_YEARS,
    );
    const oldestAllowed = new Date(todayUtc);
    oldestAllowed.setUTCFullYear(
      oldestAllowed.getUTCFullYear() - MAX_BIRTH_AGE_YEARS,
    );

    if (parsedDate < oldestAllowed || parsedDate > youngestAllowed) {
      throw new BadRequestException({
        code: SKIN_PROFILE_ERROR_CODES.EssentialsRequired,
        message: 'Date of birth must be between 5 and 80 years ago',
      });
    }
  }

  private async syncUserProfileFields(
    userId: string,
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
  ): Promise<void> {
    const patch: {
      date_of_birth?: string | null;
      sex_at_birth?: string | null;
    } = {};

    if (dto.dateOfBirth !== undefined) {
      patch.date_of_birth = dto.dateOfBirth ?? null;
    }

    if (dto.sexAtBirth !== undefined) {
      patch.sex_at_birth = dto.sexAtBirth ?? null;
    }

    if (Object.keys(patch).length > 0) {
      await this.usersService.update(userId, patch);
    }
  }

  private dtoTouchesHealthContext(
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
  ): boolean {
    return (
      dto.pregnancyStatus !== undefined ||
      dto.underDermatologistCare !== undefined ||
      dto.safetyContext !== undefined
    );
  }

  private dtoTouchesHormonalContext(
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
  ): boolean {
    return dto.hormonalContext !== undefined;
  }

  private async ensureLocationConsent(
    userId: string,
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
    existingProfile?: SkinProfile,
  ): Promise<void> {
    if (dto.countryCode === undefined && dto.city === undefined) {
      return;
    }

    const nextCountryCode =
      dto.countryCode !== undefined
        ? (dto.countryCode ?? null)
        : (existingProfile?.country_code ?? null);
    const nextCity =
      dto.city !== undefined
        ? (dto.city ?? null)
        : (existingProfile?.city ?? null);

    if (!this.hasLocationData(nextCountryCode, nextCity)) {
      return;
    }

    const activeConsent = await this.findActiveLocationConsent(userId);
    if (activeConsent && dto.locationConsent === false) {
      return;
    }
    if (activeConsent) {
      return;
    }

    if (dto.locationConsent !== true) {
      throw new BadRequestException(
        'Location consent is required when saving country or city',
      );
    }
  }

  private async ensureHealthContextConsent(
    userId: string,
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
    existingProfile?: SkinProfile,
  ): Promise<void> {
    if (!this.dtoTouchesHealthContext(dto)) {
      return;
    }

    const projected: SkinProfile = {
      ...(existingProfile ?? ({} as SkinProfile)),
      pregnancy_status:
        dto.pregnancyStatus !== undefined
          ? (dto.pregnancyStatus ?? null)
          : (existingProfile?.pregnancy_status ?? null),
      under_dermatologist_care:
        dto.underDermatologistCare !== undefined
          ? (dto.underDermatologistCare ?? null)
          : (existingProfile?.under_dermatologist_care ?? null),
      safety_context:
        dto.safetyContext !== undefined
          ? (dto.safetyContext ?? {})
          : (existingProfile?.safety_context ?? {}),
    } as SkinProfile;

    if (!this.hasHealthContextData(projected)) {
      return;
    }

    const activeConsent = await this.findActiveHealthContextConsent(userId);
    if (activeConsent) {
      return;
    }

    if (dto.healthContextConsent !== true) {
      throw new ForbiddenException({
        code: SKIN_PROFILE_ERROR_CODES.HealthConsentRequired,
        message:
          'Health-context consent is required when saving sensitive health fields',
      });
    }
  }

  private async ensureHormonalContextConsent(
    userId: string,
    dto: CreateSkinProfileDto | UpdateSkinProfileDto,
    existingProfile?: SkinProfile,
  ): Promise<void> {
    if (!this.dtoTouchesHormonalContext(dto)) {
      return;
    }

    const projected: SkinProfile = {
      ...(existingProfile ?? ({} as SkinProfile)),
      hormonal_context:
        dto.hormonalContext !== undefined
          ? (dto.hormonalContext ?? {})
          : (existingProfile?.hormonal_context ?? {}),
    } as SkinProfile;

    if (!this.hasHormonalContextData(projected)) {
      return;
    }

    const activeConsent = await this.findActiveHormonalContextConsent(userId);
    if (activeConsent) {
      return;
    }

    if (dto.hormonalContextConsent !== true) {
      throw new ForbiddenException({
        code: SKIN_PROFILE_ERROR_CODES.HormonalConsentRequired,
        message:
          'Hormonal-context consent is required when saving hormonal context',
      });
    }
  }

  private async syncLocationConsent(
    userId: string,
    hasLocationData: boolean,
    explicitConsent: boolean | undefined,
  ): Promise<void> {
    const activeConsent = await this.findActiveLocationConsent(userId);

    if (activeConsent && explicitConsent === false) {
      await this.revokeLocationConsent(userId, activeConsent);
      return;
    }

    if (hasLocationData) {
      if (activeConsent) {
        return;
      }
      if (explicitConsent !== true) {
        return;
      }

      await this.consentsRepository.save(
        this.consentsRepository.create({
          user_id: userId,
          consent_type: UserConsentType.LocationProcessing,
          consent_version: this.privacyVersion,
          granted: true,
          granted_at: nowDate(),
          revoked_at: null,
          ip_address: null,
        }),
      );
      await this.dataAccessLogService.recordConsentEvent(
        userId,
        UserConsentType.LocationProcessing,
        UserDataAccessEventType.ConsentGranted,
        UserDataAccessPurpose.ConsentGrant,
      );
      return;
    }

    if (activeConsent) await this.revokeLocationConsent(userId, activeConsent);
  }

  private async revokeLocationConsent(
    userId: string,
    activeConsent: UserConsent,
  ): Promise<void> {
    activeConsent.granted = false;
    activeConsent.revoked_at = nowDate();
    await this.consentsRepository.save(activeConsent);
    await this.dataAccessLogService.recordConsentEvent(
      userId,
      UserConsentType.LocationProcessing,
      UserDataAccessEventType.ConsentRevoked,
      UserDataAccessPurpose.ConsentRevoke,
    );
  }

  private async syncHealthContextConsent(
    userId: string,
    hasHealthData: boolean,
  ): Promise<void> {
    const activeConsent = await this.findActiveHealthContextConsent(userId);

    if (hasHealthData) {
      if (activeConsent) {
        return;
      }

      await this.consentsRepository.save(
        this.consentsRepository.create({
          user_id: userId,
          consent_type: UserConsentType.HealthContextProcessing,
          consent_version: this.privacyVersion,
          granted: true,
          granted_at: nowDate(),
          revoked_at: null,
          ip_address: null,
        }),
      );
      await this.dataAccessLogService.recordConsentEvent(
        userId,
        UserConsentType.HealthContextProcessing,
        UserDataAccessEventType.ConsentGranted,
        UserDataAccessPurpose.ConsentGrant,
      );
      return;
    }

    if (activeConsent) {
      activeConsent.granted = false;
      activeConsent.revoked_at = nowDate();
      await this.consentsRepository.save(activeConsent);
      await this.dataAccessLogService.recordConsentEvent(
        userId,
        UserConsentType.HealthContextProcessing,
        UserDataAccessEventType.ConsentRevoked,
        UserDataAccessPurpose.ConsentRevoke,
      );
    }
  }

  private async syncHormonalContextConsent(
    userId: string,
    hasHormonalData: boolean,
  ): Promise<void> {
    const activeConsent = await this.findActiveHormonalContextConsent(userId);

    if (hasHormonalData) {
      if (activeConsent) {
        return;
      }

      await this.consentsRepository.save(
        this.consentsRepository.create({
          user_id: userId,
          consent_type: UserConsentType.HormonalContextProcessing,
          consent_version: this.privacyVersion,
          granted: true,
          granted_at: nowDate(),
          revoked_at: null,
          ip_address: null,
        }),
      );
      await this.dataAccessLogService.recordConsentEvent(
        userId,
        UserConsentType.HormonalContextProcessing,
        UserDataAccessEventType.ConsentGranted,
        UserDataAccessPurpose.ConsentGrant,
      );
      return;
    }

    if (activeConsent) {
      activeConsent.granted = false;
      activeConsent.revoked_at = nowDate();
      await this.consentsRepository.save(activeConsent);
      await this.dataAccessLogService.recordConsentEvent(
        userId,
        UserConsentType.HormonalContextProcessing,
        UserDataAccessEventType.ConsentRevoked,
        UserDataAccessPurpose.ConsentRevoke,
      );
    }
  }

  private async findActiveLocationConsent(
    userId: string,
  ): Promise<UserConsent | null> {
    return this.consentsRepository.findOne({
      where: {
        user_id: userId,
        consent_type: UserConsentType.LocationProcessing,
        granted: true,
        revoked_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
  }

  private async findActiveHealthContextConsent(
    userId: string,
  ): Promise<UserConsent | null> {
    return this.consentsRepository.findOne({
      where: {
        user_id: userId,
        consent_type: UserConsentType.HealthContextProcessing,
        granted: true,
        revoked_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
  }

  private async findActiveHormonalContextConsent(
    userId: string,
  ): Promise<UserConsent | null> {
    return this.consentsRepository.findOne({
      where: {
        user_id: userId,
        consent_type: UserConsentType.HormonalContextProcessing,
        granted: true,
        revoked_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
  }
}
