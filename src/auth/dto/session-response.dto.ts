import { ApiProperty } from '@nestjs/swagger';
import { AuthSession } from '../entities/auth-session.entity';

export class SessionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  userAgent: string | null;

  @ApiProperty({ nullable: true })
  ipAddress: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  lastUsedAt: string;

  static fromEntity(session: AuthSession): SessionResponseDto {
    const dto = new SessionResponseDto();
    dto.id = session.id;
    dto.userAgent = session.user_agent;
    dto.ipAddress = session.ip_address;
    dto.createdAt = session.created_at.toISOString();
    dto.lastUsedAt = session.last_used_at.toISOString();
    return dto;
  }
}
