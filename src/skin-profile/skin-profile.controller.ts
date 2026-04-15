import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateSkinProfileDto } from './dto/create-skin-profile.dto';
import { SkinProfileResponseDto } from './dto/skin-profile-response.dto';
import { UpdateSkinProfileDto } from './dto/update-skin-profile.dto';
import {
  AGE_RANGES,
  ETHNICITIES,
  ROUTINE_COMPLEXITIES,
  SKIN_CONCERNS,
  SKIN_GOALS,
  SKIN_TONES,
  SKIN_TYPES,
} from './dto/skin-profile.constants';
import { SkinProfileService } from './skin-profile.service';

@ApiTags('skin-profile')
@Controller('skin-profile')
export class SkinProfileController {
  constructor(private readonly skinProfileService: SkinProfileService) {}

  @Get('options')
  @Public()
  getOptions() {
    return {
      skinTypes: [...SKIN_TYPES],
      skinTones: [...SKIN_TONES],
      ageRanges: [...AGE_RANGES],
      ethnicities: [...ETHNICITIES],
      concerns: [...SKIN_CONCERNS],
      goals: [...SKIN_GOALS],
      complexities: [...ROUTINE_COMPLEXITIES],
    };
  }

  @Get()
  @ApiOkResponse({ type: SkinProfileResponseDto })
  async getProfile(
    @CurrentUser('id') userId: string,
  ): Promise<SkinProfileResponseDto> {
    const profile = await this.skinProfileService.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Skin profile not found');
    }
    return SkinProfileResponseDto.fromEntity(profile);
  }

  @Post()
  @ApiOkResponse({ type: SkinProfileResponseDto })
  async createProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSkinProfileDto,
  ): Promise<SkinProfileResponseDto> {
    const profile = await this.skinProfileService.create(userId, dto);
    return SkinProfileResponseDto.fromEntity(profile);
  }

  @Patch()
  @ApiOkResponse({ type: SkinProfileResponseDto })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSkinProfileDto,
  ): Promise<SkinProfileResponseDto> {
    const profile = await this.skinProfileService.update(userId, dto);
    return SkinProfileResponseDto.fromEntity(profile);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async deleteProfile(
    @CurrentUser('id') userId: string,
  ): Promise<{ message: string }> {
    await this.skinProfileService.remove(userId);
    return { message: 'Skin profile deleted' };
  }
}
