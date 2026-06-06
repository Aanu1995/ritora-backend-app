import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { AuthResponseDto } from './auth-response.dto';

export class MobileAuthResponseDto extends AuthResponseDto {
  @ApiProperty()
  refreshToken: string;

  constructor(
    accessToken: string,
    user: UserResponseDto,
    refreshToken: string,
  ) {
    super(accessToken, user, refreshToken);
    this.refreshToken = refreshToken;
  }
}
