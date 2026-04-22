import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApplyPresetDto } from './dto/apply-preset.dto';
import { CreateSlotDto } from './dto/create-slot.dto';
import { CreateSlotsDto } from './dto/create-slots.dto';
import { MoveSlotDto } from './dto/move-slot.dto';
import {
  ScheduleResponseDto,
  TodaysScheduleResponseDto,
} from './dto/schedule-response.dto';
import { ScheduleSlotResponseDto } from './dto/schedule-slot-response.dto';
import { UpdateSlotDto } from './dto/update-slot.dto';
import { UpsertRoutineStepsDto } from './dto/upsert-routine-steps.dto';
import { ScheduleService } from './schedule.service';
import { ScheduleSlot } from './entities/schedule-slot.entity';

@ApiTags('schedule')
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  @ApiOkResponse({ type: ScheduleResponseDto })
  async getSchedule(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone?: string,
  ): Promise<ScheduleResponseDto> {
    const slots = await this.scheduleService.getForUser(userId);
    return this.toScheduleResponse(slots, timeZone, requestTimeZone);
  }

  @Get('today')
  @ApiOkResponse({ type: TodaysScheduleResponseDto })
  async getTodaysSchedule(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone?: string,
  ): Promise<TodaysScheduleResponseDto> {
    const effectiveTimeZone = this.scheduleService.resolveEffectiveTimeZone(
      timeZone,
      requestTimeZone,
    );
    const day = this.scheduleService.resolveTodayDay(timeZone, requestTimeZone);
    const slots = await this.scheduleService.getTodaysSchedule(userId, day);
    return TodaysScheduleResponseDto.fromEntities(
      day,
      effectiveTimeZone,
      slots,
    );
  }

  @Post('slots')
  @ApiOkResponse({ type: ScheduleSlotResponseDto })
  async createSlot(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSlotDto,
  ): Promise<ScheduleSlotResponseDto> {
    const slot = await this.scheduleService.createSlot(userId, dto);
    return ScheduleSlotResponseDto.fromEntity(slot);
  }

  @Post('slots/batch')
  @ApiOkResponse({ type: ScheduleResponseDto })
  async createSlots(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone: string | undefined,
    @Body() dto: CreateSlotsDto,
  ): Promise<ScheduleResponseDto> {
    const slots = await this.scheduleService.createSlots(userId, dto);
    return this.toScheduleResponse(slots, timeZone, requestTimeZone);
  }

  @Post('apply-preset')
  @ApiOkResponse({ type: ScheduleResponseDto })
  async applyPreset(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone: string | undefined,
    @Body() dto: ApplyPresetDto,
  ): Promise<ScheduleResponseDto> {
    const slots = await this.scheduleService.applyEveryDayPreset(userId, dto);
    return this.toScheduleResponse(slots, timeZone, requestTimeZone);
  }

  @Patch('slots/:id')
  @ApiOkResponse({ type: ScheduleSlotResponseDto })
  async updateSlot(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSlotDto,
  ): Promise<ScheduleSlotResponseDto> {
    const slot = await this.scheduleService.updateSlot(userId, id, dto);
    return ScheduleSlotResponseDto.fromEntity(slot);
  }

  @Delete('slots/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSlot(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.scheduleService.deleteSlot(userId, id);
  }

  @Put('slots/:id/steps')
  @ApiOkResponse({ type: ScheduleSlotResponseDto })
  async upsertSteps(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpsertRoutineStepsDto,
  ): Promise<ScheduleSlotResponseDto> {
    const slot = await this.scheduleService.upsertSteps(userId, id, dto);
    return ScheduleSlotResponseDto.fromEntity(slot);
  }

  @Post('slots/:id/move')
  @ApiOkResponse({ type: ScheduleSlotResponseDto })
  async moveSlot(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: MoveSlotDto,
  ): Promise<ScheduleSlotResponseDto> {
    const slot = await this.scheduleService.moveSlot(userId, id, dto);
    return ScheduleSlotResponseDto.fromEntity(slot);
  }

  private toScheduleResponse(
    slots: ScheduleSlot[],
    savedTimeZone: string | null,
    requestTimeZone?: string,
  ): ScheduleResponseDto {
    return ScheduleResponseDto.fromEntities(
      slots,
      this.scheduleService.resolveEffectiveTimeZone(
        savedTimeZone,
        requestTimeZone,
      ),
    );
  }
}
