import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserDataAccessLogResponseDto } from '../users/dto/user-data-access-log-response.dto';
import { UserDataAccessPurpose } from '../users/user-consent.constants';
import { CreateSkinProfileDto } from './dto/create-skin-profile.dto';
import { SkinProfileResponseDto } from './dto/skin-profile-response.dto';
import { UpdateSkinProfileDto } from './dto/update-skin-profile.dto';
import {
  ACTIVE_INGREDIENT_KEYS,
  ACTIVE_TOLERANCE_LEVELS,
  ALCOHOL_LEVELS,
  BUDGET_TIERS,
  CLIMATE_SENSITIVITIES,
  CYCLE_PATTERNS,
  DIET_FLAGS,
  ETHNICITIES,
  FITZPATRICK_PHOTOTYPES,
  HYDRATION_LEVELS,
  HORMONAL_BREAKOUT_PATTERNS,
  INGREDIENT_ETHICS,
  PREGNANCY_STATUSES,
  PROCEDURE_TYPES,
  REACTION_CERTAINTIES,
  REACTION_SEVERITIES,
  REACTION_TRIGGER_TYPES,
  REACTION_TYPES,
  ROUTINE_PACES,
  SENSITIVITY_LEVELS,
  SEX_AT_BIRTH,
  SKIN_CONCERNS,
  SKIN_CONDITIONS,
  SKIN_MEDICATIONS,
  SKIN_TONES,
  SKIN_TYPES,
  SLEEP_LEVELS,
  SMOKING_LEVELS,
  STRESS_LEVELS,
  SUNSCREEN_FILTERS,
  SUNSCREEN_FINISHES,
  SUNSCREEN_HABITS,
  SUNSCREEN_TOLERANCES,
  TENDENCY_LEVELS,
  TEXTURE_PREFERENCES,
  WATER_HARDNESS_LEVELS,
  WATER_INTAKE_LEVELS,
  WATER_SENSITIVITY_LEVELS,
} from './dto/skin-profile.constants';
import { SkinProfileService } from './skin-profile.service';

@ApiTags('skin-profile')
@Controller('skin-profile')
export class SkinProfileController {
  constructor(private readonly skinProfileService: SkinProfileService) {}

  @Get('options')
  @Public()
  getOptions() {
    return {
      skinTypes: [...SKIN_TYPES],
      skinTones: [...SKIN_TONES],
      ethnicities: [...ETHNICITIES],
      concerns: [...SKIN_CONCERNS],
      fitzpatrickPhototypes: [...FITZPATRICK_PHOTOTYPES],
      sensitivityLevels: [...SENSITIVITY_LEVELS],
      hydrationLevels: [...HYDRATION_LEVELS],
      pregnancyStatuses: [...PREGNANCY_STATUSES],
      sexAtBirth: [...SEX_AT_BIRTH],
      conditions: [...SKIN_CONDITIONS],
      medications: [...SKIN_MEDICATIONS],
      procedureTypes: [...PROCEDURE_TYPES],
      sunscreenHabits: [...SUNSCREEN_HABITS],
      sunscreenTolerances: [...SUNSCREEN_TOLERANCES],
      sunscreenFilters: [...SUNSCREEN_FILTERS],
      sunscreenFinishes: [...SUNSCREEN_FINISHES],
      tendencyLevels: [...TENDENCY_LEVELS],
      activeIngredients: [...ACTIVE_INGREDIENT_KEYS],
      activeToleranceLevels: [...ACTIVE_TOLERANCE_LEVELS],
      routinePaces: [...ROUTINE_PACES],
      budgetTiers: [...BUDGET_TIERS],
      texturePreferences: [...TEXTURE_PREFERENCES],
      ingredientEthics: [...INGREDIENT_ETHICS],
      reactionTriggerTypes: [...REACTION_TRIGGER_TYPES],
      reactionTypes: [...REACTION_TYPES],
      reactionSeverities: [...REACTION_SEVERITIES],
      reactionCertainties: [...REACTION_CERTAINTIES],
      sleepLevels: [...SLEEP_LEVELS],
      stressLevels: [...STRESS_LEVELS],
      waterIntakeLevels: [...WATER_INTAKE_LEVELS],
      waterHardnessLevels: [...WATER_HARDNESS_LEVELS],
      waterSensitivityLevels: [...WATER_SENSITIVITY_LEVELS],
      dietFlags: [...DIET_FLAGS],
      smokingLevels: [...SMOKING_LEVELS],
      alcoholLevels: [...ALCOHOL_LEVELS],
      climateSensitivities: [...CLIMATE_SENSITIVITIES],
      cyclePatterns: [...CYCLE_PATTERNS],
      hormonalBreakoutPatterns: [...HORMONAL_BREAKOUT_PATTERNS],
    };
  }

  @Get('access-logs')
  @ApiOkResponse({ type: [UserDataAccessLogResponseDto] })
  async getAccessLogs(
    @CurrentUser('id') userId: string,
  ): Promise<UserDataAccessLogResponseDto[]> {
    const logs = await this.skinProfileService.listDataAccessLogs(userId);
    return logs.map((log) => UserDataAccessLogResponseDto.fromEntity(log));
  }

  @Get()
  @ApiOkResponse({ type: SkinProfileResponseDto })
  async getProfile(
    @CurrentUser('id') userId: string,
  ): Promise<SkinProfileResponseDto> {
    const profile = await this.skinProfileService.findByUserId(userId, {
      recordSensitiveAccess: true,
      accessPurpose: UserDataAccessPurpose.SkinProfileRead,
    });
    if (!profile) {
      throw new NotFoundException('Skin profile not found');
    }
    return SkinProfileResponseDto.fromEntity(profile, {
      completeness: this.skinProfileService.computeCompleteness(profile),
      hasLocationContextConsent:
        await this.skinProfileService.hasActiveLocationContextConsent(userId),
      hasHealthContextConsent:
        await this.skinProfileService.hasActiveHealthContextConsent(userId),
      hasHormonalContextConsent:
        await this.skinProfileService.hasActiveHormonalContextConsent(userId),
    });
  }

  @Post()
  @ApiOkResponse({ type: SkinProfileResponseDto })
  async createProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSkinProfileDto,
  ): Promise<SkinProfileResponseDto> {
    const profile = await this.skinProfileService.create(userId, dto);
    return SkinProfileResponseDto.fromEntity(profile, {
      completeness: this.skinProfileService.computeCompleteness(profile),
      hasLocationContextConsent:
        await this.skinProfileService.hasActiveLocationContextConsent(userId),
      hasHealthContextConsent:
        await this.skinProfileService.hasActiveHealthContextConsent(userId),
      hasHormonalContextConsent:
        await this.skinProfileService.hasActiveHormonalContextConsent(userId),
    });
  }

  @Patch()
  @ApiOkResponse({ type: SkinProfileResponseDto })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSkinProfileDto,
  ): Promise<SkinProfileResponseDto> {
    const profile = await this.skinProfileService.update(userId, dto);
    return SkinProfileResponseDto.fromEntity(profile, {
      completeness: this.skinProfileService.computeCompleteness(profile),
      hasLocationContextConsent:
        await this.skinProfileService.hasActiveLocationContextConsent(userId),
      hasHealthContextConsent:
        await this.skinProfileService.hasActiveHealthContextConsent(userId),
      hasHormonalContextConsent:
        await this.skinProfileService.hasActiveHormonalContextConsent(userId),
    });
  }

  @Delete('health-context')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SkinProfileResponseDto })
  async deleteHealthContext(
    @CurrentUser('id') userId: string,
  ): Promise<SkinProfileResponseDto> {
    const profile = await this.skinProfileService.clearHealthContext(userId);
    return SkinProfileResponseDto.fromEntity(profile, {
      completeness: this.skinProfileService.computeCompleteness(profile),
      hasLocationContextConsent:
        await this.skinProfileService.hasActiveLocationContextConsent(userId),
      hasHealthContextConsent:
        await this.skinProfileService.hasActiveHealthContextConsent(userId),
      hasHormonalContextConsent:
        await this.skinProfileService.hasActiveHormonalContextConsent(userId),
    });
  }

  @Delete('hormonal-context')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SkinProfileResponseDto })
  async deleteHormonalContext(
    @CurrentUser('id') userId: string,
  ): Promise<SkinProfileResponseDto> {
    const profile = await this.skinProfileService.clearHormonalContext(userId);
    return SkinProfileResponseDto.fromEntity(profile, {
      completeness: this.skinProfileService.computeCompleteness(profile),
      hasLocationContextConsent:
        await this.skinProfileService.hasActiveLocationContextConsent(userId),
      hasHealthContextConsent:
        await this.skinProfileService.hasActiveHealthContextConsent(userId),
      hasHormonalContextConsent:
        await this.skinProfileService.hasActiveHormonalContextConsent(userId),
    });
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async deleteProfile(
    @CurrentUser('id') userId: string,
  ): Promise<{ message: string }> {
    await this.skinProfileService.remove(userId);
    return { message: 'Skin profile deleted' };
  }
}
