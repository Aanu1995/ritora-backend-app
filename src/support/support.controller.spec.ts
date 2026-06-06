import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { UserRestrictionCapability } from '../users/user-restrictions';
import {
  USER_RESTRICTION_ALLOWED_CAPABILITIES_KEY,
  UserRestrictionGuard,
} from '../users/user-restriction.guard';
import {
  SupportFeedbackStatus,
  SupportFeedbackType,
} from './entities/support-feedback-item.entity';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

function getRouteGuards(methodName: keyof SupportController): unknown[] {
  const method = SupportController.prototype[methodName] as object;

  return Reflect.getMetadata(GUARDS_METADATA, method) ?? [];
}

describe('SupportController', () => {
  it('protects user feedback submission from CSRF and support-contact restrictions', () => {
    expect(getRouteGuards('createFeedback')).toContain(OriginCheckGuard);
    expect(getRouteGuards('createFeedback')).toContain(UserRestrictionGuard);
    expect(
      Reflect.getMetadata(
        USER_RESTRICTION_ALLOWED_CAPABILITIES_KEY,
        SupportController.prototype.createFeedback,
      ),
    ).toEqual([UserRestrictionCapability.DisableSupportContact]);
  });

  it('passes authenticated user feedback with request context to the support service', async () => {
    const service = {
      createUserFeedback: jest.fn(async () => ({
        createdAt: '2026-05-22T08:00:00.000Z',
        id: 'feedback-1',
        status: SupportFeedbackStatus.New,
      })),
    } as unknown as SupportService;
    const controller = new SupportController(service);

    await expect(
      controller.createFeedback(
        '01USER',
        {
          context: { locale: 'en', route: '/shelf' },
          description: 'The shelf filters are confusing after adding products.',
          title: 'Shelf filter feedback',
          type: SupportFeedbackType.ConfusingResult,
        },
        {
          headers: {
            'user-agent': 'Safari',
          },
          ip: '127.0.0.1',
        } as never,
      ),
    ).resolves.toEqual({
      createdAt: '2026-05-22T08:00:00.000Z',
      id: 'feedback-1',
      status: SupportFeedbackStatus.New,
    });

    expect(service.createUserFeedback).toHaveBeenCalledWith(
      '01USER',
      {
        context: { locale: 'en', route: '/shelf' },
        description: 'The shelf filters are confusing after adding products.',
        title: 'Shelf filter feedback',
        type: SupportFeedbackType.ConfusingResult,
      },
      {
        ip: '127.0.0.1',
        userAgent: 'Safari',
      },
    );
  });
});
