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
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Get('me')
  @ApiOkResponse({ type: UserResponseDto })
  async getMe(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findByIdOrFail(userId);
    return UserResponseDto.fromEntity(user);
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

    return UserResponseDto.fromEntity(user);
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

    return UserResponseDto.fromEntity(user);
  }

  @Patch('me/time-zone')
  @ApiOkResponse({ type: UserResponseDto })
  async updateTimeZone(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserTimeZoneDto,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.updateTimeZone(userId, dto.timeZone);

    return UserResponseDto.fromEntity(user);
  }
}
