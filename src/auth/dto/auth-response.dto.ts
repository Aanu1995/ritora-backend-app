import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  declare refreshToken?: string;

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
