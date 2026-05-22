import { User } from '../users/entities/user.entity';
import { ApplicationTrackingService } from './application-tracking.service';
import { ApplicationLogsController } from './application-tracking.controller';
import {
  EditApplicationDto,
  RecordApplicationDto,
} from './dto/application-log-item.dto';

describe('ApplicationLogsController', () => {
  const service = {
    record: jest.fn(),
    edit: jest.fn(),
    getAnalytics: jest.fn(),
    getOne: jest.fn(),
    getVersions: jest.fn(),
  } as unknown as jest.Mocked<ApplicationTrackingService>;
  const controller = new ApplicationLogsController(service);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates record and edit mutations with authenticated user context', async () => {
    const recordPayload = {
      targetDate: '2026-05-04',
      items: [],
    } as RecordApplicationDto;
    const editPayload = {
      items: [],
      editReason: 'Corrected',
    } as EditApplicationDto;
    service.record.mockResolvedValue({ id: 'log-1' } as never);
    service.edit.mockResolvedValue({ id: 'log-1', editCount: 1 } as never);

    await controller.record(user(), recordPayload);
    await controller.edit(user(), 'log-1', editPayload);

    expect(service.record).toHaveBeenCalledWith(user(), recordPayload);
    expect(service.edit).toHaveBeenCalledWith(user(), 'log-1', editPayload);
  });

  it('delegates analytics, single record, and version reads', async () => {
    service.getAnalytics.mockResolvedValue({ totalLogs: 1 } as never);
    service.getOne.mockResolvedValue({ id: 'log-1' } as never);
    service.getVersions.mockResolvedValue([{ version: 1 }] as never);

    await controller.getAnalytics(user(), '2026-05-01', '2026-05-04');
    await controller.getOne(user(), 'log-1');
    await controller.getVersions(user(), 'log-1');

    expect(service.getAnalytics).toHaveBeenCalledWith(user(), {
      from: '2026-05-01',
      to: '2026-05-04',
    });
    expect(service.getOne).toHaveBeenCalledWith(user(), 'log-1');
    expect(service.getVersions).toHaveBeenCalledWith(user(), 'log-1');
  });
});

function user(): User {
  return { id: 'user-1' } as User;
}
