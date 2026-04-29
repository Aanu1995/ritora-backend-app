import { ApiProperty } from '@nestjs/swagger';

export class AppNavBadgesResponseDto {
  @ApiProperty()
  notifications_unread_count: number;

  @ApiProperty()
  skin_journal_warning_count: number;
}
