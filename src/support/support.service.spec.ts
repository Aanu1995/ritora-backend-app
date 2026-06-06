import {
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  AdminAccount,
  AdminAccountRole,
  AdminAccountStatus,
} from '../admin/entities/admin-account.entity';
import {
  AdminAuditAction,
  AdminAuditLog,
} from '../admin/entities/admin-audit-log.entity';
import {
  AdminNotification,
  AdminNotificationSeverity,
  AdminNotificationType,
} from '../admin/entities/admin-notification.entity';
import {
  SupportFeedbackPriority,
  SupportFeedbackSource,
  SupportFeedbackStatus,
  SupportFeedbackType,
  encryptedFeedbackDescriptionTransformer,
} from './entities/support-feedback-item.entity';
import { SupportFeedbackNote } from './entities/support-feedback-note.entity';
import { SupportFeedbackItem } from './entities/support-feedback-item.entity';
import { SupportService } from './support.service';

const actor = {
  email: 'ops@ritora.app',
  id: 'admin-ops',
  name: 'Ops Admin',
  role: AdminAccountRole.Admin,
  sessionId: 'admin-session',
  status: AdminAccountStatus.Active,
};

function createSupportDataSourceMock(options: {
  feedbackRepository?: Record<string, unknown>;
  notesRepository?: Record<string, unknown>;
  auditLogsRepository?: Record<string, unknown>;
  accountsRepository?: Record<string, unknown>;
  notificationsRepository?: Record<string, unknown>;
  query?: jest.Mock;
}): DataSource {
  const feedbackRepository = {
    create: jest.fn((value: Partial<SupportFeedbackItem>) => value),
    findOne: jest.fn(),
    save: jest.fn(async (value: SupportFeedbackItem) => value),
    ...options.feedbackRepository,
  };
  const notesRepository = {
    create: jest.fn((value: Partial<SupportFeedbackNote>) => value),
    findAndCount: jest.fn(async () => [[], 0]),
    save: jest.fn(async (value: SupportFeedbackNote) => value),
    ...options.notesRepository,
  };
  const auditLogsRepository = {
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn(async (value: Record<string, unknown>) => value),
    ...options.auditLogsRepository,
  };
  const accountsRepository = {
    find: jest.fn(async () => []),
    findOne: jest.fn(),
    ...options.accountsRepository,
  };
  const query = options.query ?? jest.fn();
  const notificationsRepository = {
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn(async (value: unknown) => value),
    ...options.notificationsRepository,
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === SupportFeedbackItem) return feedbackRepository;
      if (entity === SupportFeedbackNote) return notesRepository;
      if (entity === AdminAuditLog) return auditLogsRepository;
      if (entity === AdminAccount) return accountsRepository;
      if (entity === AdminNotification) return notificationsRepository;
      if (entity === User) {
        return {
          findOne: jest.fn(),
        };
      }
      throw new Error('Unexpected repository requested');
    }),
    query,
  };

  return {
    getRepository: manager.getRepository,
    query,
    transaction: jest.fn(
      async (
        operation: (transactionManager: typeof manager) => Promise<unknown>,
      ) => operation(manager),
    ),
  } as unknown as DataSource;
}

describe('SupportService', () => {
  it('lists admin feedback inbox items with indexed filters and sanitized context', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        assigned_admin_email: 'ops@ritora.app',
        assigned_admin_id: 'admin-ops',
        assigned_admin_name: 'Ops Admin',
        closed_at: null,
        context: {
          appVersion: '1.0.0',
          requestId: 'req-1',
          route: '/check-product',
          secret: 'must-not-leak',
          token: 'also-hidden',
        },
        created_at: '2026-05-22T08:00:00.000Z',
        created_by_admin_email: null,
        created_by_admin_id: null,
        created_by_admin_name: null,
        description: encryptedFeedbackDescriptionTransformer.to(
          'The product scan result was confusing.',
        ),
        id: 'feedback-1',
        note_count: '2',
        priority: SupportFeedbackPriority.High,
        reporter_email: 'jane@example.com',
        source: SupportFeedbackSource.UserWebApp,
        status: SupportFeedbackStatus.New,
        title: 'Confusing product check result',
        total_count: '1',
        type: SupportFeedbackType.ConfusingResult,
        updated_at: '2026-05-22T08:10:00.000Z',
        user_email: 'jane@example.com',
        user_first_name: 'Jane',
        user_id: '01USER',
        user_last_name: 'Doe',
      },
    ]);
    const service = new SupportService(createSupportDataSourceMock({ query }));

    await expect(
      service.listAdminFeedback({
        limit: 20,
        page: 1,
        query: 'scan_%',
        status: SupportFeedbackStatus.New,
        type: SupportFeedbackType.ConfusingResult,
      }),
    ).resolves.toEqual({
      feedback: [
        {
          assignedAdmin: {
            email: 'ops@ritora.app',
            id: 'admin-ops',
            name: 'Ops Admin',
          },
          assignedAdminId: 'admin-ops',
          closedAt: null,
          context: {
            appVersion: '1.0.0',
            requestId: 'req-1',
            route: '/check-product',
          },
          createdAt: '2026-05-22T08:00:00.000Z',
          createdByAdmin: null,
          createdByAdminId: null,
          description: 'The product scan result was confusing.',
          id: 'feedback-1',
          noteCount: 2,
          priority: SupportFeedbackPriority.High,
          reporterEmail: 'jane@example.com',
          source: SupportFeedbackSource.UserWebApp,
          status: SupportFeedbackStatus.New,
          title: 'Confusing product check result',
          type: SupportFeedbackType.ConfusingResult,
          updatedAt: '2026-05-22T08:10:00.000Z',
          user: {
            email: 'jane@example.com',
            id: '01USER',
            name: 'Jane Doe',
          },
          userId: '01USER',
        },
      ],
      hasNextPage: false,
      hasPreviousPage: false,
      limit: 20,
      page: 1,
      total: 1,
      totalPages: 1,
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('WITH paged_feedback AS');
    expect(sql).toContain('COUNT(*) OVER()');
    expect(sql).toContain('LEFT JOIN users');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('FROM paged_feedback feedback');
    expect(sql).toContain(`users.canonical_email ILIKE $4`);
    expect(sql).toContain(`feedback.id = $5`);
    expect(sql).toContain(
      'ORDER BY feedback.updated_at DESC, feedback.id DESC',
    );
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('photo_object_key');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      SupportFeedbackStatus.New,
      SupportFeedbackType.ConfusingResult,
      '%scan\\_\\%%',
      '%scan\\_\\%%',
      'scan_%',
      20,
      0,
    ]);
  });

  it('creates user feedback without admin-only fields and with sanitized context', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        email: 'jane@example.com',
        first_name: 'Jane',
        id: '01USER',
        last_name: 'Doe',
      },
    ]);
    const savedFeedback = {
      assigned_admin_id: null,
      closed_at: null,
      closed_by_admin_id: null,
      context: {
        locale: 'en',
        requestId: 'req-1',
        route: '/shelf',
      },
      created_at: new Date('2026-05-22T08:00:00.000Z'),
      created_by_admin_id: null,
      description: 'I expected the shelf filter to remember my choice.',
      id: 'feedback-1',
      priority: SupportFeedbackPriority.Medium,
      reporter_email: 'jane@example.com',
      source: SupportFeedbackSource.UserWebApp,
      status: SupportFeedbackStatus.New,
      title: 'Shelf filter feedback',
      type: SupportFeedbackType.Suggestion,
      updated_at: new Date('2026-05-22T08:00:00.000Z'),
      user_id: '01USER',
      generateId: jest.fn(),
    } as SupportFeedbackItem;
    const feedbackRepository = {
      create: jest.fn(() => savedFeedback),
      save: jest.fn(async () => savedFeedback),
    };
    const service = new SupportService(
      createSupportDataSourceMock({ feedbackRepository, query }),
    );

    await expect(
      service.createUserFeedback('01USER', {
        context: {
          locale: 'en',
          requestId: 'req-1',
          route: '/shelf',
          token: 'must-not-store',
        },
        description: 'I expected the shelf filter to remember my choice.',
        title: 'Shelf filter feedback',
        type: SupportFeedbackType.Suggestion,
      }),
    ).resolves.toEqual({
      createdAt: '2026-05-22T08:00:00.000Z',
      id: 'feedback-1',
      status: SupportFeedbackStatus.New,
    });

    expect(feedbackRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_admin_id: null,
        context: {
          locale: 'en',
          requestId: 'req-1',
          route: '/shelf',
        },
        created_by_admin_id: null,
        priority: SupportFeedbackPriority.Medium,
        source: SupportFeedbackSource.UserWebApp,
        status: SupportFeedbackStatus.New,
        user_id: '01USER',
      }),
    );
  });

  it('rate-limits user support submissions before writing feedback', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        day_count: '6',
        email: 'jane@example.com',
        first_name: 'Jane',
        hour_count: '5',
        id: '01USER',
        last_name: 'Doe',
      },
    ]);
    const feedbackRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };
    const service = new SupportService(
      createSupportDataSourceMock({ feedbackRepository, query }),
    );

    const error = await service
      .createUserFeedback('01USER', {
        description: 'I need help with this result.',
        title: 'Support request',
        type: SupportFeedbackType.Other,
      })
      .catch((caughtError: unknown) => caughtError);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(feedbackRepository.create).not.toHaveBeenCalled();
    expect(feedbackRepository.save).not.toHaveBeenCalled();
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'COUNT(*) FILTER (WHERE feedback.created_at >= $2)',
    );
    expect(String(query.mock.calls[0]?.[0])).toContain('FOR UPDATE OF users');
  });

  it('promotes unsafe user support reports into privacy-safe admin alerts', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        day_count: '0',
        email: 'jane@example.com',
        first_name: 'Jane',
        hour_count: '0',
        id: '01USER',
        last_name: 'Doe',
      },
    ]);
    const savedFeedback = {
      assigned_admin_id: null,
      closed_at: null,
      closed_by_admin_id: null,
      context: { route: '/routine' },
      created_at: new Date('2026-05-22T08:00:00.000Z'),
      created_by_admin_id: null,
      description: 'The recommendation seemed unsafe for my skin.',
      id: 'feedback-safety',
      priority: SupportFeedbackPriority.High,
      reporter_email: 'jane@example.com',
      source: SupportFeedbackSource.UserWebApp,
      status: SupportFeedbackStatus.New,
      title: 'Unsafe recommendation',
      type: SupportFeedbackType.UnsafeRecommendation,
      updated_at: new Date('2026-05-22T08:00:00.000Z'),
      user_id: '01USER',
      generateId: jest.fn(),
    } as SupportFeedbackItem;
    const feedbackRepository = {
      create: jest.fn(() => savedFeedback),
      save: jest.fn(async () => savedFeedback),
    };
    const notificationsRepository = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn(async (value: unknown) => value),
    };
    const service = new SupportService(
      createSupportDataSourceMock({
        accountsRepository: {
          find: jest.fn(async () => [{ id: actor.id }]),
        },
        feedbackRepository,
        notificationsRepository,
        query,
      }),
    );

    await expect(
      service.createUserFeedback(
        '01USER',
        {
          context: { route: '/routine' },
          description: 'The recommendation seemed unsafe for my skin.',
          title: 'Unsafe recommendation',
          type: SupportFeedbackType.UnsafeRecommendation,
        },
        { ip: '127.0.0.1', userAgent: 'Safari' },
      ),
    ).resolves.toMatchObject({
      id: 'feedback-safety',
      status: SupportFeedbackStatus.New,
    });

    expect(feedbackRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: SupportFeedbackPriority.High,
        type: SupportFeedbackType.UnsafeRecommendation,
      }),
    );
    expect(notificationsRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        admin_id: actor.id,
        metadata: {
          feedbackId: 'feedback-safety',
          priority: SupportFeedbackPriority.High,
          source: SupportFeedbackSource.UserWebApp,
          status: SupportFeedbackStatus.New,
          type: SupportFeedbackType.UnsafeRecommendation,
        },
        title: 'High priority support item',
      }),
    ]);
  });

  it('creates privacy-safe admin notifications for urgent support feedback', async () => {
    const savedFeedback = {
      assigned_admin_id: null,
      closed_at: null,
      closed_by_admin_id: null,
      context: { route: '/settings' },
      created_at: new Date('2026-05-22T08:00:00.000Z'),
      created_by_admin_id: actor.id,
      description: 'Private customer problem should stay encrypted only.',
      id: 'feedback-urgent',
      priority: SupportFeedbackPriority.High,
      reporter_email: 'customer@example.com',
      source: SupportFeedbackSource.SupportEmail,
      status: SupportFeedbackStatus.New,
      title: 'Private customer title',
      type: SupportFeedbackType.Account,
      updated_at: new Date('2026-05-22T08:00:00.000Z'),
      user_id: null,
      generateId: jest.fn(),
    } as SupportFeedbackItem;
    const notificationsRepository = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn(async (value: unknown) => value),
    };
    const service = new SupportService(
      createSupportDataSourceMock({
        accountsRepository: {
          find: jest.fn(async () => [
            { id: actor.id, status: AdminAccountStatus.Active },
            { id: 'admin-root', status: AdminAccountStatus.Active },
          ]),
        },
        feedbackRepository: {
          create: jest.fn(() => savedFeedback),
          save: jest.fn(async () => savedFeedback),
        },
        notificationsRepository,
      }),
    );

    await service.createAdminFeedback(
      actor,
      {
        description: 'Private customer problem should stay encrypted only.',
        priority: SupportFeedbackPriority.High,
        reason: 'Support item created from priority support channel',
        reporterEmail: 'customer@example.com',
        source: SupportFeedbackSource.SupportEmail,
        title: 'Private customer title',
        type: SupportFeedbackType.Account,
      },
      { ip: '127.0.0.1', sessionId: actor.sessionId, userAgent: 'Safari' },
    );

    expect(notificationsRepository.create).toHaveBeenCalledTimes(2);
    expect(notificationsRepository.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action_url: '/support?status=new&priority=high',
          admin_id: actor.id,
          body: 'A high priority support item needs review.',
          metadata: {
            feedbackId: 'feedback-urgent',
            priority: SupportFeedbackPriority.High,
            source: SupportFeedbackSource.SupportEmail,
            status: SupportFeedbackStatus.New,
            type: SupportFeedbackType.Account,
          },
          severity: AdminNotificationSeverity.Warning,
          title: 'High priority support item',
          type: AdminNotificationType.SupportFeedbackAlert,
        }),
      ]),
    );
    const serializedNotifications = JSON.stringify(
      notificationsRepository.save.mock.calls,
    );
    expect(serializedNotifications).not.toContain('Private customer title');
    expect(serializedNotifications).not.toContain(
      'Private customer problem should stay encrypted only.',
    );
    expect(serializedNotifications).not.toContain('customer@example.com');
  });

  it('keeps support ticket creation successful when admin notification delivery fails', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        day_count: '0',
        email: 'jane@example.com',
        first_name: 'Jane',
        hour_count: '0',
        id: '01USER',
        last_name: 'Doe',
      },
    ]);
    const savedFeedback = {
      assigned_admin_id: null,
      closed_at: null,
      closed_by_admin_id: null,
      context: { route: '/routine' },
      created_at: new Date('2026-05-22T08:00:00.000Z'),
      created_by_admin_id: null,
      description: 'The recommendation seemed unsafe for my skin.',
      id: 'feedback-notification-failure',
      priority: SupportFeedbackPriority.High,
      reporter_email: 'jane@example.com',
      source: SupportFeedbackSource.UserWebApp,
      status: SupportFeedbackStatus.New,
      title: 'Unsafe recommendation',
      type: SupportFeedbackType.UnsafeRecommendation,
      updated_at: new Date('2026-05-22T08:00:00.000Z'),
      user_id: '01USER',
      generateId: jest.fn(),
    } as SupportFeedbackItem;
    const notificationsRepository = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn(async () => {
        throw new Error('notification insert failed');
      }),
    };
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const service = new SupportService(
      createSupportDataSourceMock({
        accountsRepository: {
          find: jest.fn(async () => [{ id: actor.id }]),
        },
        feedbackRepository: {
          create: jest.fn(() => savedFeedback),
          save: jest.fn(async () => savedFeedback),
        },
        notificationsRepository,
        query,
      }),
    );

    await expect(
      service.createUserFeedback('01USER', {
        description: 'The recommendation seemed unsafe for my skin.',
        title: 'Unsafe recommendation',
        type: SupportFeedbackType.UnsafeRecommendation,
      }),
    ).resolves.toMatchObject({
      id: 'feedback-notification-failure',
      status: SupportFeedbackStatus.New,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to create support notification for feedback feedback-notification-failure',
      ),
    );
    warnSpy.mockRestore();
  });

  it('updates admin feedback assignment/status and writes a redacted audit log', async () => {
    const feedback = {
      assigned_admin_id: null,
      closed_at: null,
      closed_by_admin_id: null,
      context: { requestId: 'req-1', token: 'must-not-leak' },
      created_at: new Date('2026-05-22T08:00:00.000Z'),
      created_by_admin_id: null,
      description: 'Contains private support details.',
      id: 'feedback-1',
      priority: SupportFeedbackPriority.Medium,
      reporter_email: 'jane@example.com',
      source: SupportFeedbackSource.SupportEmail,
      status: SupportFeedbackStatus.New,
      title: 'Login support issue',
      type: SupportFeedbackType.Account,
      updated_at: new Date('2026-05-22T08:00:00.000Z'),
      user_id: '01USER',
      generateId: jest.fn(),
    } as SupportFeedbackItem;
    const auditLogsRepository = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn(async (value: Record<string, unknown>) => value),
    };
    const service = new SupportService(
      createSupportDataSourceMock({
        accountsRepository: {
          findOne: jest.fn(async () => ({
            email: actor.email,
            id: actor.id,
            name: actor.name,
            status: AdminAccountStatus.Active,
          })),
        },
        auditLogsRepository,
        feedbackRepository: {
          findOne: jest.fn(async () => feedback),
          save: jest.fn(async (value: SupportFeedbackItem) => value),
        },
      }),
    );

    await expect(
      service.updateAdminFeedback(
        actor,
        'feedback-1',
        {
          assignedAdminId: actor.id,
          priority: SupportFeedbackPriority.High,
          reason: 'Support issue triaged for launch review',
          status: SupportFeedbackStatus.Triaged,
        },
        { ip: '127.0.0.1', sessionId: actor.sessionId, userAgent: 'Safari' },
      ),
    ).resolves.toMatchObject({
      assignedAdminId: actor.id,
      priority: SupportFeedbackPriority.High,
      status: SupportFeedbackStatus.Triaged,
    });

    expect(auditLogsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.SupportFeedbackUpdated,
        metadata: expect.not.objectContaining({
          description: expect.any(String),
          title: expect.any(String),
          token: expect.any(String),
        }),
        reason: 'Support issue triaged for launch review',
        target_user_id: '01USER',
      }),
    );
  });

  it('does not spam admins when an already urgent support item is updated', async () => {
    const feedback = {
      assigned_admin_id: null,
      closed_at: null,
      closed_by_admin_id: null,
      context: {},
      created_at: new Date('2026-05-22T08:00:00.000Z'),
      created_by_admin_id: null,
      description: 'Private support details.',
      id: 'feedback-urgent',
      priority: SupportFeedbackPriority.High,
      reporter_email: null,
      source: SupportFeedbackSource.SupportEmail,
      status: SupportFeedbackStatus.New,
      title: 'Urgent item',
      type: SupportFeedbackType.Account,
      updated_at: new Date('2026-05-22T08:00:00.000Z'),
      user_id: null,
      generateId: jest.fn(),
    } as SupportFeedbackItem;
    const notificationsRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };
    const service = new SupportService(
      createSupportDataSourceMock({
        feedbackRepository: {
          findOne: jest.fn(async () => feedback),
          save: jest.fn(async (value: SupportFeedbackItem) => value),
        },
        notificationsRepository,
      }),
    );

    await service.updateAdminFeedback(
      actor,
      'feedback-urgent',
      {
        reason: 'Support item triaged without changing urgency',
        status: SupportFeedbackStatus.Triaged,
      },
      { ip: '127.0.0.1', sessionId: actor.sessionId, userAgent: 'Safari' },
    );

    expect(notificationsRepository.create).not.toHaveBeenCalled();
    expect(notificationsRepository.save).not.toHaveBeenCalled();
  });

  it('adds encrypted feedback notes and audits the note id only', async () => {
    const feedback = {
      id: 'feedback-1',
      status: SupportFeedbackStatus.Triaged,
      user_id: '01USER',
    } as SupportFeedbackItem;
    const savedNote = {
      author_admin_id: actor.id,
      body: 'Followed up from external support mailbox.',
      created_at: new Date('2026-05-22T09:00:00.000Z'),
      feedback_id: 'feedback-1',
      id: 'note-1',
    } as SupportFeedbackNote;
    const auditLogsRepository = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn(async (value: Record<string, unknown>) => value),
    };
    const service = new SupportService(
      createSupportDataSourceMock({
        auditLogsRepository,
        feedbackRepository: { findOne: jest.fn(async () => feedback) },
        notesRepository: {
          create: jest.fn(() => savedNote),
          save: jest.fn(async () => savedNote),
        },
      }),
    );

    await expect(
      service.createAdminFeedbackNote(
        actor,
        'feedback-1',
        {
          body: 'Followed up from external support mailbox.',
          reason: 'Support note added after external reply',
        },
        { ip: '127.0.0.1', sessionId: actor.sessionId, userAgent: 'Safari' },
      ),
    ).resolves.toEqual({
      authorAdminId: actor.id,
      author: { email: actor.email, id: actor.id, name: actor.name },
      body: 'Followed up from external support mailbox.',
      createdAt: '2026-05-22T09:00:00.000Z',
      feedbackId: 'feedback-1',
      id: 'note-1',
    });

    expect(auditLogsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.SupportFeedbackNoteCreated,
        metadata: { feedbackId: 'feedback-1', noteId: 'note-1' },
      }),
    );
  });

  it('rejects notes for missing feedback items', async () => {
    const service = new SupportService(
      createSupportDataSourceMock({
        feedbackRepository: { findOne: jest.fn(async () => null) },
      }),
    );

    await expect(
      service.createAdminFeedbackNote(
        actor,
        'missing',
        {
          body: 'Follow up note.',
          reason: 'Support note added after external reply',
        },
        { ip: '127.0.0.1', sessionId: actor.sessionId, userAgent: 'Safari' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
