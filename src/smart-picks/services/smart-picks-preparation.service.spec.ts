import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { User } from '../../users/entities/user.entity';
import { SmartPicksOverviewService } from './smart-picks-overview.service';
import { SmartPicksPreparationService } from './smart-picks-preparation.service';

describe('SmartPicksPreparationService', () => {
  it('prepares a smart picks overview for a changed user in the background', async () => {
    const users = repo<User>();
    const overview = {
      getOverview: jest.fn().mockResolvedValue({}),
    };
    const changedUser = user();
    users.findOne.mockResolvedValue(changedUser);
    const service = await buildService(users, overview);

    service.scheduleForUser('user-1');
    await service.waitForIdle();

    expect(users.findOne).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
    expect(overview.getOverview).toHaveBeenCalledWith(changedUser, null);
  });

  it('coalesces repeated preparation requests into one rerun after the current job', async () => {
    const users = repo<User>();
    const deferred = deferredValue<void>();
    users.findOne.mockResolvedValue(user());
    const overview = {
      getOverview: jest
        .fn()
        .mockReturnValueOnce(deferred.promise)
        .mockResolvedValueOnce({}),
    };
    const service = await buildService(users, overview);

    service.scheduleForUser('user-1');
    service.scheduleForUser('user-1');
    service.scheduleForUser('user-1');
    deferred.resolve();
    await service.waitForIdle();

    expect(overview.getOverview).toHaveBeenCalledTimes(2);
  });

  it('does not call overview generation after the user is gone', async () => {
    const users = repo<User>();
    users.findOne.mockResolvedValue(null);
    const overview = {
      getOverview: jest.fn().mockResolvedValue({}),
    };
    const service = await buildService(users, overview);

    service.scheduleForUser('deleted-user');
    await service.waitForIdle();

    expect(overview.getOverview).not.toHaveBeenCalled();
  });
});

async function buildService(
  users: jest.Mocked<Repository<User>>,
  overview: Pick<SmartPicksOverviewService, 'getOverview'>,
) {
  const module = await Test.createTestingModule({
    providers: [
      SmartPicksPreparationService,
      { provide: getRepositoryToken(User), useValue: users },
      { provide: SmartPicksOverviewService, useValue: overview },
    ],
  }).compile();

  return module.get(SmartPicksPreparationService);
}

function repo<T extends object>() {
  return {
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function user(): User {
  return { id: 'user-1', time_zone: 'Europe/Stockholm' } as User;
}

function deferredValue<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
