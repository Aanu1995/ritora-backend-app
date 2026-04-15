import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersService } from '../users/users.service';
import { CreateSkinProfileDto } from './dto/create-skin-profile.dto';
import { UpdateSkinProfileDto } from './dto/update-skin-profile.dto';
import { SkinProfile } from './entities/skin-profile.entity';

@Injectable()
export class SkinProfileService {
  private readonly privacyVersion: string;

  constructor(
    @InjectRepository(SkinProfile)
    private readonly profileRepository: Repository<SkinProfile>,
    @InjectRepository(UserConsent)
    private readonly consentsRepository: Repository<UserConsent>,
    private readonly usersService: UsersService,
    configService: ConfigService,
  ) {
    this.privacyVersion = configService.get('LEGAL_PRIVACY_VERSION', '1.0.0');
  }

  async findByUserId(userId: string): Promise<SkinProfile | null> {
    return this.profileRepository.findOne({ where: { user_id: userId } });
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

    await this.ensureLocationConsent(userId, dto);

    const profile = this.profileRepository.create({
      user_id: userId,
      skin_type: dto.skinType ?? null,
      skin_tone: dto.skinTone ?? null,
      age_range: dto.ageRange ?? null,
      ethnicity: dto.ethnicity ?? null,
      current_concerns: dto.currentConcerns ?? [],
      known_sensitivities: dto.knownSensitivities ?? [],
      skin_goals: dto.skinGoals ?? [],
      country_code: dto.countryCode ?? null,
      city: dto.city ?? null,
      routine_complexity: dto.routineComplexity ?? null,
    });

    const savedProfile = await this.profileRepository.save(profile);
    await this.syncLocationConsent(
      userId,
      this.hasLocationData(savedProfile.country_code, savedProfile.city),
    );

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

    if (dto.skinType !== undefined) profile.skin_type = dto.skinType ?? null;
    if (dto.skinTone !== undefined) profile.skin_tone = dto.skinTone ?? null;
    if (dto.ageRange !== undefined) profile.age_range = dto.ageRange ?? null;
    if (dto.ethnicity !== undefined) profile.ethnicity = dto.ethnicity ?? null;
    if (dto.currentConcerns !== undefined)
      profile.current_concerns = dto.currentConcerns;
    if (dto.knownSensitivities !== undefined)
      profile.known_sensitivities = dto.knownSensitivities;
    if (dto.skinGoals !== undefined) profile.skin_goals = dto.skinGoals;
    if (dto.countryCode !== undefined)
      profile.country_code = dto.countryCode ?? null;
    if (dto.city !== undefined) profile.city = dto.city ?? null;
    if (dto.routineComplexity !== undefined)
      profile.routine_complexity = dto.routineComplexity ?? null;

    await this.ensureLocationConsent(userId, dto, profile);

    const savedProfile = await this.profileRepository.save(profile);
    await this.syncLocationConsent(
      userId,
      this.hasLocationData(savedProfile.country_code, savedProfile.city),
    );

    return savedProfile;
  }

  async remove(userId: string): Promise<void> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Skin profile not found');
    }
    await this.profileRepository.remove(profile);
    await this.syncLocationConsent(userId, false);
  }

  private hasLocationData(
    countryCode: string | null | undefined,
    city: string | null | undefined,
  ): boolean {
    return Boolean(countryCode?.trim() || city?.trim());
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
    if (activeConsent) {
      return;
    }

    if (dto.locationConsent !== true) {
      throw new BadRequestException(
        'Location consent is required when saving country or city',
      );
    }
  }

  private async syncLocationConsent(
    userId: string,
    hasLocationData: boolean,
  ): Promise<void> {
    const activeConsent = await this.findActiveLocationConsent(userId);

    if (hasLocationData) {
      if (activeConsent) {
        return;
      }

      await this.consentsRepository.save(
        this.consentsRepository.create({
          user_id: userId,
          consent_type: 'location_processing',
          consent_version: this.privacyVersion,
          granted: true,
          granted_at: new Date(),
          revoked_at: null,
          ip_address: null,
        }),
      );
      return;
    }

    if (activeConsent) {
      activeConsent.granted = false;
      activeConsent.revoked_at = new Date();
      await this.consentsRepository.save(activeConsent);
    }
  }

  private async findActiveLocationConsent(
    userId: string,
  ): Promise<UserConsent | null> {
    return this.consentsRepository.findOne({
      where: {
        user_id: userId,
        consent_type: 'location_processing',
        granted: true,
        revoked_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
  }
}
