import { ApiProperty } from '@nestjs/swagger';
import { toIsoString } from '../../common/utils/date';
import { User } from '../entities/user.entity';

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty()
  preferredLanguage: string;

  @ApiProperty()
  createdAt: string;

  constructor(
    id: string,
    email: string,
    firstName: string,
    lastName: string,
    emailVerified: boolean,
    preferredLanguage: string,
    createdAt: string,
  ) {
    this.id = id;
    this.email = email;
    this.firstName = firstName;
    this.lastName = lastName;
    this.emailVerified = emailVerified;
    this.preferredLanguage = preferredLanguage;
    this.createdAt = createdAt;
  }

  static fromEntity(user: User): UserResponseDto {
    return new UserResponseDto(
      user.id,
      user.email,
      user.first_name,
      user.last_name,
      user.email_verified,
      user.preferred_language,
      toIsoString(user.created_at),
    );
  }
}
