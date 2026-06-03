import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export interface AuthResponseDto {
  refreshToken?: string;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  constructor(
    accessToken: string,
    user: UserResponseDto,
    refreshToken?: string,
  ) {
    this.accessToken = accessToken;
    this.user = user;
    if (refreshToken) {
      this.refreshToken = refreshToken;
    }
  }
}
