import { ApiProperty } from '@nestjs/swagger';
import { toIsoString } from '../../common/utils/date';
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

  constructor(
    id: string,
    userAgent: string | null,
    ipAddress: string | null,
    createdAt: string,
    lastUsedAt: string,
  ) {
    this.id = id;
    this.userAgent = userAgent;
    this.ipAddress = ipAddress;
    this.createdAt = createdAt;
    this.lastUsedAt = lastUsedAt;
  }

  static fromEntity(session: AuthSession): SessionResponseDto {
    return new SessionResponseDto(
      session.id,
      session.user_agent,
      session.ip_address,
      toIsoString(session.created_at),
      toIsoString(session.last_used_at),
    );
  }
}
