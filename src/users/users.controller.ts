import { Body, Controller, Get, Patch, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { normalizeLanguage } from '../common/i18n/i18n';
import { setLocaleCookie } from '../common/i18n/locale-cookie';
import { UpdateUserLanguageDto } from './dto/update-user-language.dto';
import { UpdateUserTimeZoneDto } from './dto/update-user-time-zone.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { User } from './entities/user.entity';
import { UserCapabilitySnapshotService } from './user-capability-snapshot.service';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly capabilitySnapshot: UserCapabilitySnapshotService,
  ) {}

  @Get('me')
  @ApiOkResponse({ type: UserResponseDto })
  async getMe(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findByIdForAuth(userId);
    if (!user) {
      return this.toUserResponse(
        await this.usersService.findByIdOrFail(userId),
      );
    }
    return this.toUserResponse(user, Boolean(user.password_hash));
  }

  @Patch('me')
  @ApiOkResponse({ type: UserResponseDto })
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.updateProfile(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    const authUser = await this.usersService.findByIdForAuth(userId);
    return this.toUserResponse(user, Boolean(authUser?.password_hash));
  }

  @Patch('me/language')
  @ApiOkResponse({ type: UserResponseDto })
  async updateLanguage(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserLanguageDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.updatePreferredLanguage(
      userId,
      dto.preferredLanguage,
    );

    setLocaleCookie(
      res,
      this.configService,
      normalizeLanguage(user.preferred_language),
    );

    const authUser = await this.usersService.findByIdForAuth(userId);
    return this.toUserResponse(user, Boolean(authUser?.password_hash));
  }

  @Patch('me/time-zone')
  @ApiOkResponse({ type: UserResponseDto })
  async updateTimeZone(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserTimeZoneDto,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.updateTimeZone(userId, dto.timeZone);

    const authUser = await this.usersService.findByIdForAuth(userId);
    return this.toUserResponse(user, Boolean(authUser?.password_hash));
  }

  private async toUserResponse(
    user: User,
    hasPassword?: boolean,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(
      user,
      hasPassword,
      await this.capabilitySnapshot.buildForUser(user),
    );
  }
}
