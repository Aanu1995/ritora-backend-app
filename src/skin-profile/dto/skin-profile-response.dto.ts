import { ApiProperty } from '@nestjs/swagger';
import { toIsoString } from '../../common/utils/date';
import { SkinProfile } from '../entities/skin-profile.entity';

export class SkinProfileResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  skinType: string | null;

  @ApiProperty({ nullable: true })
  skinTone: string | null;

  @ApiProperty({ nullable: true })
  ageRange: string | null;

  @ApiProperty({ nullable: true })
  ethnicity: string | null;

  @ApiProperty({ type: [String] })
  currentConcerns: string[];

  @ApiProperty({ type: [String] })
  knownSensitivities: string[];

  @ApiProperty({ type: [String] })
  skinGoals: string[];

  @ApiProperty({ nullable: true })
  countryCode: string | null;

  @ApiProperty({ nullable: true })
  city: string | null;

  @ApiProperty({ nullable: true })
  routineComplexity: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(
    id: string,
    skinType: string | null,
    skinTone: string | null,
    ageRange: string | null,
    ethnicity: string | null,
    currentConcerns: string[],
    knownSensitivities: string[],
    skinGoals: string[],
    countryCode: string | null,
    city: string | null,
    routineComplexity: string | null,
    createdAt: string,
    updatedAt: string,
  ) {
    this.id = id;
    this.skinType = skinType;
    this.skinTone = skinTone;
    this.ageRange = ageRange;
    this.ethnicity = ethnicity;
    this.currentConcerns = currentConcerns;
    this.knownSensitivities = knownSensitivities;
    this.skinGoals = skinGoals;
    this.countryCode = countryCode;
    this.city = city;
    this.routineComplexity = routineComplexity;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static fromEntity(profile: SkinProfile): SkinProfileResponseDto {
    return new SkinProfileResponseDto(
      profile.id,
      profile.skin_type,
      profile.skin_tone,
      profile.age_range,
      profile.ethnicity,
      profile.current_concerns,
      profile.known_sensitivities,
      profile.skin_goals,
      profile.country_code,
      profile.city,
      profile.routine_complexity,
      toIsoString(profile.created_at),
      toIsoString(profile.updated_at),
    );
  }
}
