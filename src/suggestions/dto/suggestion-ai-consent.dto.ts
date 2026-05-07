import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateSuggestionAiConsentDto {
  @ApiProperty()
  @IsBoolean()
  granted: boolean;
}

export class SuggestionAiConsentResponseDto {
  @ApiProperty()
  granted: boolean;

  @ApiProperty({ nullable: true })
  grantedAt: string | null;

  @ApiProperty()
  canReadSensitiveContext: boolean;

  @ApiProperty({ nullable: true })
  blockedReason: string | null;

  @ApiProperty({ type: [String] })
  activeSensitiveConsentTypes: string[];
}
