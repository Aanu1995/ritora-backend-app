import { ApiProperty } from '@nestjs/swagger';
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

  static fromEntity(profile: SkinProfile): SkinProfileResponseDto {
    const dto = new SkinProfileResponseDto();
    dto.id = profile.id;
    dto.skinType = profile.skin_type;
    dto.skinTone = profile.skin_tone;
    dto.ageRange = profile.age_range;
    dto.ethnicity = profile.ethnicity;
    dto.currentConcerns = profile.current_concerns;
    dto.knownSensitivities = profile.known_sensitivities;
    dto.skinGoals = profile.skin_goals;
    dto.countryCode = profile.country_code;
    dto.city = profile.city;
    dto.routineComplexity = profile.routine_complexity;
    dto.createdAt = profile.created_at.toISOString();
    dto.updatedAt = profile.updated_at.toISOString();
    return dto;
  }
}
