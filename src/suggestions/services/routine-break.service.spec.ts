import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { ScheduledNotification } from '../../notifications/entities/scheduled-notification.entity';
import { User } from '../../users/entities/user.entity';
import { RoutineBreak } from '../entities/routine-break.entity';
import { RoutineBreakService } from './routine-break.service';

type TestTransactionManager = {
  getRepository: (entity: unknown) => Repository<ObjectLiteral>;
};
type TestTransactionCallback = (
  manager: TestTransactionManager,
) => Promise<unknown>;
type TransactionMock = jest.Mock<
  Promise<unknown>,
  [callback: TestTransactionCallback]
>;

describe('RoutineBreakService', () => {
  const breakRepo = repo<RoutineBreak>();
  const scheduledNotificationRepo = repo<ScheduledNotification>();
  const txUserRepo = repo<User>();
  const service = new RoutineBreakService(breakRepo, scheduledNotificationRepo);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-06T08:00:00.000Z'));
    transactionMock(breakRepo).mockImplementation(async (callback) =>
      callback({
        getRepository: (entity: unknown) => {
          if (entity === RoutineBreak) return breakRepo;
          if (entity === ScheduledNotification)
            return scheduledNotificationRepo;
          if (entity === User) return txUserRepo;
          throw new Error('Unexpected repository token.');
        },
      }),
    );
    txUserRepo.findOne.mockResolvedValue(user());
    breakRepo.create.mockImplementation((value) => value as RoutineBreak);
    breakRepo.save.mockImplementation(async (value) => value as RoutineBreak);
    breakRepo.find.mockResolvedValue([]);
    breakRepo.findOne.mockResolvedValue(null);
    scheduledNotificationRepo.update.mockResolvedValue({
      affected: 0,
      raw: [],
      generatedMaps: [],
    });
  });

  it('serializes break creation by locking the user row before checking overlap', async () => {
    await service.startBreak(user(), {
      endsAt: '2026-05-07T08:00:00.000Z',
    });

    expect(transactionMock(breakRepo)).toHaveBeenCalledTimes(1);
    expect(txUserRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts an active break and cancels pending suggestion notifications', async () => {
    const state = await service.startBreak(user(), {
      endsAt: '2026-05-07T08:00:00.000Z',
      reason: 'Travelling',
    });

    expect(breakRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        starts_at: new Date('2026-05-06T08:00:00.000Z'),
        ends_at: new Date('2026-05-07T08:00:00.000Z'),
        reason: 'Travelling',
        status: 'active',
      }),
    );
    expect(scheduledNotificationRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        status: 'pending',
      }),
      expect.objectContaining({
        status: 'cancelled',
        last_error: 'routine_break_active',
      }),
    );
    expect(state.routineBreak).toEqual(
      expect.objectContaining({
        status: 'active',
        endsAt: '2026-05-07T08:00:00.000Z',
        canResumeNow: true,
      }),
    );
  });

  it('rejects overlapping active or upcoming breaks', async () => {
    breakRepo.findOne.mockResolvedValue(routineBreak({ id: 'break-1' }));

    await expect(service.startBreak(user(), {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('resumes the current break without deleting the audit row', async () => {
    breakRepo.find.mockResolvedValue([routineBreak({ id: 'break-1' })]);

    await expect(service.resumeActiveBreak(user())).resolves.toEqual({
      routineBreak: null,
    });

    expect(breakRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'break-1',
        status: 'resumed',
        resumed_at: new Date('2026-05-06T08:00:00.000Z'),
      }),
    );
  });

  it('updates only the owner break resume date', async () => {
    breakRepo.findOne.mockResolvedValue(
      routineBreak({ id: 'break-1', userId: 'other-user' }),
    );

    await expect(
      service.updateBreak(user(), 'break-1', {
        endsAt: '2026-05-08T08:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('finds active user ids while ignoring expired breaks', async () => {
    breakRepo.find.mockResolvedValue([
      routineBreak({ userId: 'user-1' }),
      routineBreak({
        userId: 'user-2',
        startsAt: new Date('2026-05-05T08:00:00.000Z'),
        endsAt: new Date('2026-05-06T07:59:00.000Z'),
      }),
    ]);

    await expect(
      service.getActiveUserIds(['user-1', 'user-2']),
    ).resolves.toEqual(new Set(['user-1']));
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
    save: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function transactionMock(
  repository: Repository<RoutineBreak>,
): TransactionMock {
  return repository.manager.transaction as unknown as TransactionMock;
}

function user(): User {
  return { id: 'user-1' } as User;
}

function routineBreak(
  input: {
    id?: string;
    userId?: string;
    startsAt?: Date;
    endsAt?: Date | null;
  } = {},
): RoutineBreak {
  return {
    id: input.id ?? 'break-1',
    user_id: input.userId ?? 'user-1',
    starts_at: input.startsAt ?? new Date('2026-05-06T08:00:00.000Z'),
    ends_at: input.endsAt ?? null,
    reason: null,
    status: 'active',
    resumed_at: null,
    created_at: new Date('2026-05-06T08:00:00.000Z'),
    updated_at: new Date('2026-05-06T08:00:00.000Z'),
  } as RoutineBreak;
}
