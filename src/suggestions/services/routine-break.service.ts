import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { toIsoString, toNullableIsoString } from '../../common/utils/date';
import { ScheduledNotification } from '../../notifications/entities/scheduled-notification.entity';
import { User } from '../../users/entities/user.entity';
import {
  RoutineBreakResponseDto,
  RoutineBreakStateResponseDto,
  StartRoutineBreakDto,
  UpdateRoutineBreakDto,
} from '../dto/suggestion-routine-break.dto';
import { RoutineBreak } from '../entities/routine-break.entity';
import {
  ROUTINE_BREAK_ACTIVE_MESSAGE,
  ROUTINE_BREAK_NOTIFICATION_CANCEL_REASON,
  ROUTINE_BREAK_NOTIFICATION_KINDS,
} from '../suggestions.constants';

@Injectable()
export class RoutineBreakService {
  constructor(
    @InjectRepository(RoutineBreak)
    private readonly breakRepo: Repository<RoutineBreak>,
    @InjectRepository(ScheduledNotification)
    private readonly scheduledNotificationRepo: Repository<ScheduledNotification>,
  ) {}

  async getBreakState(
    user: User,
    now = new Date(),
  ): Promise<RoutineBreakStateResponseDto> {
    const breakRow = await this.findCurrentOrUpcomingBreak(user.id, now);
    return { routineBreak: breakRow ? toBreakResponse(breakRow, now) : null };
  }

  async startBreak(
    user: User,
    payload: StartRoutineBreakDto,
    now = new Date(),
  ): Promise<RoutineBreakStateResponseDto> {
    return this.breakRepo.manager.transaction(async (manager) => {
      await manager.getRepository(User).findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });

      const breakRepo = manager.getRepository(RoutineBreak);
      const scheduledNotificationRepo = manager.getRepository(
        ScheduledNotification,
      );
      const existing = await this.findCurrentOrUpcomingBreak(
        user.id,
        now,
        breakRepo,
      );
      if (existing) {
        throw new ConflictException('A routine break is already active.');
      }

      const endsAt = parseOptionalEnd(payload.endsAt, now);
      const breakRow = await breakRepo.save(
        breakRepo.create({
          user_id: user.id,
          starts_at: now,
          ends_at: endsAt,
          reason: normalizeReason(payload.reason),
          status: 'active',
          resumed_at: null,
        }),
      );

      await this.cancelPendingSuggestionNotifications(
        user.id,
        scheduledNotificationRepo,
      );

      return { routineBreak: toBreakResponse(breakRow, now) };
    });
  }

  async resumeActiveBreak(
    user: User,
    now = new Date(),
  ): Promise<RoutineBreakStateResponseDto> {
    const activeBreak = await this.findActiveBreak(user.id, now);
    if (!activeBreak) return { routineBreak: null };

    activeBreak.status = 'resumed';
    activeBreak.resumed_at = now;
    activeBreak.ends_at = now;
    await this.breakRepo.save(activeBreak);

    return { routineBreak: null };
  }

  async updateBreak(
    user: User,
    breakId: string,
    payload: UpdateRoutineBreakDto,
    now = new Date(),
  ): Promise<RoutineBreakStateResponseDto> {
    const breakRow = await this.breakRepo.findOne({ where: { id: breakId } });
    if (!breakRow) throw new NotFoundException('Routine break not found.');
    if (breakRow.user_id !== user.id) {
      throw new ForbiddenException('Routine break belongs to another user.');
    }
    if (breakRow.status !== 'active') {
      throw new ConflictException('This routine break is no longer active.');
    }

    if (payload.endsAt !== undefined) {
      breakRow.ends_at =
        payload.endsAt === null ? null : parseOptionalEnd(payload.endsAt, now);
    }
    const saved = await this.breakRepo.save(breakRow);
    return { routineBreak: toBreakResponse(saved, now) };
  }

  async isRoutineBreakActive(
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    return (await this.findActiveBreak(userId, now)) !== null;
  }

  async getActiveUserIds(
    userIds: string[],
    now = new Date(),
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.breakRepo.find({
      where: [
        {
          user_id: In(userIds),
          status: 'active',
          starts_at: LessThanOrEqual(now),
          ends_at: IsNull(),
        },
        {
          user_id: In(userIds),
          status: 'active',
          starts_at: LessThanOrEqual(now),
          ends_at: MoreThan(now),
        },
      ],
    });
    return new Set(
      rows.filter((row) => isActive(row, now)).map((row) => row.user_id),
    );
  }

  private async findCurrentOrUpcomingBreak(
    userId: string,
    now: Date,
    repository: Repository<RoutineBreak> = this.breakRepo,
  ): Promise<RoutineBreak | null> {
    const breakRow = await repository.findOne({
      where: [
        { user_id: userId, status: 'active', ends_at: IsNull() },
        { user_id: userId, status: 'active', ends_at: MoreThan(now) },
      ],
      order: { starts_at: 'ASC' },
    });
    if (!breakRow || isExpired(breakRow, now)) return null;
    return breakRow;
  }

  private async findActiveBreak(
    userId: string,
    now: Date,
  ): Promise<RoutineBreak | null> {
    const breakRows = await this.breakRepo.find({
      where: [
        {
          user_id: userId,
          status: 'active',
          starts_at: LessThanOrEqual(now),
          ends_at: IsNull(),
        },
        {
          user_id: userId,
          status: 'active',
          starts_at: LessThanOrEqual(now),
          ends_at: MoreThan(now),
        },
      ],
      order: { starts_at: 'ASC' },
      take: 1,
    });
    return breakRows.find((row) => isActive(row, now)) ?? null;
  }

  private async cancelPendingSuggestionNotifications(
    userId: string,
    repository: Repository<ScheduledNotification> = this
      .scheduledNotificationRepo,
  ): Promise<void> {
    await repository.update(
      {
        user_id: userId,
        status: 'pending',
        kind: In([...ROUTINE_BREAK_NOTIFICATION_KINDS]),
      },
      {
        status: 'cancelled',
        last_error: ROUTINE_BREAK_NOTIFICATION_CANCEL_REASON,
        locked_at: null,
      },
    );
  }
}

function parseOptionalEnd(
  value: string | null | undefined,
  now: Date,
): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Routine break end date is invalid.');
  }
  if (parsed.getTime() <= now.getTime()) {
    throw new BadRequestException(
      'Routine break end date must be in the future.',
    );
  }
  return parsed;
}

function normalizeReason(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toBreakResponse(
  breakRow: RoutineBreak,
  now: Date,
): RoutineBreakResponseDto {
  return {
    id: breakRow.id,
    status:
      breakRow.starts_at.getTime() <= now.getTime() ? 'active' : 'upcoming',
    startedAt: toIsoString(breakRow.starts_at),
    endsAt: toNullableIsoString(breakRow.ends_at),
    canResumeNow: breakRow.starts_at.getTime() <= now.getTime(),
    message: ROUTINE_BREAK_ACTIVE_MESSAGE,
  };
}

function isActive(breakRow: RoutineBreak, now: Date): boolean {
  return (
    breakRow.status === 'active' &&
    breakRow.starts_at.getTime() <= now.getTime() &&
    (breakRow.ends_at === null || breakRow.ends_at.getTime() > now.getTime())
  );
}

function isExpired(breakRow: RoutineBreak, now: Date): boolean {
  return (
    breakRow.ends_at !== null && breakRow.ends_at.getTime() <= now.getTime()
  );
}
