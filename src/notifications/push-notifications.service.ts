import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { isIP } from 'net';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import webpush, { WebPushError } from 'web-push';
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type AppLanguage,
} from '../common/i18n/i18n';
import {
  NotificationKind,
  NotificationSeverity,
} from './entities/in-app-notification.entity';
import {
  PushDeliveryStatusValue,
  PushNotificationDelivery,
} from './entities/push-notification-delivery.entity';
import {
  PushNotificationSubscription,
  PushPlatform,
  PushPlatformValue,
  PushProvider,
  PushProviderValue,
} from './entities/push-notification-subscription.entity';
import {
  PushPublicKeyResponseDto,
  PushStatusResponseDto,
  PushSubscriptionResponseDto,
  UpsertPushSubscriptionDto,
} from './dto/push-notification-subscription.dto';
import { isUniqueConstraintError } from './notifications.service.helpers';

export type PushNotificationPayload = {
  userId: string;
  kind: NotificationKind;
  titleKey: string;
  bodyKey: string;
  severity?: NotificationSeverity;
  payload?: Record<string, unknown>;
  deepLink?: string;
  dedupeKey?: string;
  notificationId?: string;
  language?: string | null;
};

type PushCopy = {
  title: string;
  body: string;
};

type ProviderPushPayload = {
  title: string;
  body: string;
  icon: string;
  badge: string;
  tag: string;
  data: {
    kind: NotificationKind;
    severity: NotificationSeverity;
    deepLink: string;
    notificationId: string | null;
  };
};

type PushMaintenanceResult = {
  requeued: number;
  retried: number;
  sent: number;
  failed: number;
  skipped: number;
};

type NormalizedPushSubscriptionInput = {
  provider: PushProvider;
  platform: PushPlatform;
  endpoint?: string;
  keys?: {
    p256dh: string;
    auth: string;
  };
  token?: string;
  device_name?: string;
};

const PUSH_DELIVERY_MAX_ATTEMPTS = 3;
const PUSH_SUBSCRIPTIONS_PER_USER_LIMIT = 20;
const PUSH_USER_AGENT_MAX_LENGTH = 512;
const PUSH_DELIVERY_RETRY_BATCH_SIZE = 100;
const PUSH_DELIVERY_STALE_BATCH_SIZE = 100;
const PUSH_DELIVERY_STALE_MS = 10 * 60 * 1000;
const PUSH_DELIVERY_MAINTENANCE_MS = 60 * 1000;
const PUSH_DELIVERY_TIMEOUT_MS = 10 * 1000;
const PUSH_STATUS_RECENT_DELIVERY_LIMIT = 100;
const PUSH_DELIVERY_BACKOFF_SECONDS = [60, 5 * 60, 15 * 60];
const PUSH_NOTIFICATION_TTL_SECONDS = 24 * 60 * 60;
const PUSH_ERROR_MESSAGE = {
  unavailable: 'Browser push is not configured on this server.',
  notFound: 'Push subscription was not found.',
  invalidWebPushPlatform: 'Web push subscriptions must use the web platform.',
  invalidFcmPlatform: 'FCM subscriptions must use an iOS or Android platform.',
  invalidApnsPlatform: 'APNs subscriptions must use the iOS platform.',
  invalidEndpoint: 'Web push endpoint must be a valid HTTPS push service URL.',
  missingWebKeys:
    'Web push subscriptions require an endpoint, p256dh key, and auth key.',
  missingToken: 'Mobile push subscriptions require a device token.',
  tooManySubscriptions:
    'Too many push subscriptions. Remove an old device before adding another.',
  inactiveSubscription: 'Push subscription is no longer active.',
  unsupportedProvider: 'Push provider is not supported for delivery yet.',
  missingPayload: 'Stored push payload is missing.',
  claimExpired: 'Push delivery claim expired before it could be sent.',
  deliveryExpired: 'Push subscription expired.',
  deliveryForbidden: 'Push service rejected the subscription.',
  deliveryBadRequest: 'Push service rejected the payload.',
  deliveryRateLimited: 'Push service rate limited delivery.',
  deliveryTransient: 'Push service temporarily unavailable.',
  deliveryFailed: 'Push delivery failed.',
} as const;

const GENERIC_PUSH_COPY: Record<
  AppLanguage,
  Partial<Record<NotificationKind, PushCopy>>
> = {
  en: {
    photo_reminder: {
      title: "Time for today's photo",
      body: 'Take it in steady light, the same window each day.',
    },
    reaction_detected: {
      title: 'We paused your routine',
      body: 'Your photo today shows changes. Switched to barrier mode while your skin settles.',
    },
    simplification_started: {
      title: 'Your routine is simpler today',
      body: 'Barrier mode is on. You can switch back any time.',
    },
    doctor_referral: {
      title: 'Worth seeing a dermatologist',
      body: 'A pattern keeps coming back. A specialist could help.',
    },
    insight_ready: {
      title: 'A new insight is ready',
      body: 'Your photos are telling a quiet story.',
    },
    wrapped_ready: {
      title: 'Your week in skin is ready',
      body: 'Small wins, honest gaps, one thing to try next.',
    },
    analysis_failed: {
      title: 'Photo analysis hit a snag',
      body: 'Tap to retry. Your photo is safe.',
    },
    export_ready: {
      title: 'Your data export is ready',
      body: 'Tap to download.',
    },
    suggestion_ready: {
      title: 'Your routine is ready',
      body: 'Take a look at the steps before you apply.',
    },
    slot_start: {
      title: 'Time for your routine',
      body: 'Steps are ready. Tap to apply and mark each one.',
    },
    recording_reminder: {
      title: 'How did it go?',
      body: 'Take 10 seconds to log what you applied.',
    },
  },
  sv: {
    photo_reminder: {
      title: 'Dags för dagens bild',
      body: 'Ta den i jämnt ljus, samma fönster varje dag.',
    },
    reaction_detected: {
      title: 'Vi pausade din rutin',
      body: 'Din bild idag visar förändringar. Bytte till barriärläge medan din hud lugnar sig.',
    },
    simplification_started: {
      title: 'Din rutin är enklare idag',
      body: 'Barriärläge är på. Du kan byta tillbaka när som helst.',
    },
    doctor_referral: {
      title: 'Värt att träffa en hudläkare',
      body: 'Ett mönster återkommer. En specialist kan hjälpa.',
    },
    insight_ready: {
      title: 'En ny insikt är klar',
      body: 'Dina bilder berättar en stilla historia.',
    },
    wrapped_ready: {
      title: 'Din vecka i hud är klar',
      body: 'Små vinster, ärliga luckor, en sak att prova härnäst.',
    },
    analysis_failed: {
      title: 'Något gick snett med bildanalysen',
      body: 'Tryck för att försöka igen. Din bild är säker.',
    },
    export_ready: {
      title: 'Din dataexport är klar',
      body: 'Tryck för att ladda ner.',
    },
    suggestion_ready: {
      title: 'Din rutin är klar',
      body: 'Titta på stegen innan du applicerar.',
    },
    slot_start: {
      title: 'Dags för din rutin',
      body: 'Stegen är klara. Tryck för att applicera och markera varje steg.',
    },
    recording_reminder: {
      title: 'Hur gick det?',
      body: 'Ta 10 sekunder och logga vad du applicerade.',
    },
  },
  es: {
    photo_reminder: {
      title: 'Hora de la foto de hoy',
      body: 'Tómala con luz constante, en la misma ventana cada día.',
    },
    reaction_detected: {
      title: 'Pausamos tu rutina',
      body: 'Tu foto de hoy muestra cambios. Activamos el modo barrera mientras tu piel se calma.',
    },
    simplification_started: {
      title: 'Tu rutina es más sencilla hoy',
      body: 'El modo barrera está activado. Puedes volver cuando quieras.',
    },
    doctor_referral: {
      title: 'Vale la pena consultar a un dermatólogo',
      body: 'Hay un patrón que vuelve a aparecer. Un especialista podría ayudar.',
    },
    insight_ready: {
      title: 'Hay un nuevo insight listo',
      body: 'Tus fotos están contando una historia tranquila.',
    },
    wrapped_ready: {
      title: 'Tu semana de piel está lista',
      body: 'Pequeños avances, huecos honestos y algo para probar después.',
    },
    analysis_failed: {
      title: 'El análisis de la foto tuvo un problema',
      body: 'Toca para intentarlo de nuevo. Tu foto está segura.',
    },
    export_ready: {
      title: 'Tu exportación de datos está lista',
      body: 'Toca para descargarla.',
    },
    suggestion_ready: {
      title: 'Tu rutina está lista',
      body: 'Revisa los pasos antes de aplicarla.',
    },
    slot_start: {
      title: 'Hora de tu rutina',
      body: 'Los pasos están listos. Toca para aplicar y marcar cada uno.',
    },
    recording_reminder: {
      title: '¿Cómo fue?',
      body: 'Tómate 10 segundos para registrar lo que aplicaste.',
    },
  },
};

@Injectable()
export class PushNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly vapidPublicKey: string;
  private readonly vapidPrivateKey: string;
  private readonly vapidSubject: string;
  private readonly webPushConfigured: boolean;
  private maintenanceTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(PushNotificationSubscription)
    private readonly subscriptions: Repository<PushNotificationSubscription>,
    @InjectRepository(PushNotificationDelivery)
    private readonly deliveries: Repository<PushNotificationDelivery>,
    private readonly configService: ConfigService,
  ) {
    this.vapidPublicKey =
      this.configService.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY')?.trim() ?? '';
    this.vapidPrivateKey =
      this.configService.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY')?.trim() ??
      '';
    this.vapidSubject =
      this.configService.get<string>('WEB_PUSH_SUBJECT')?.trim() ?? '';
    this.webPushConfigured = Boolean(
      this.vapidPublicKey && this.vapidPrivateKey && this.vapidSubject,
    );

    if (this.webPushConfigured) {
      webpush.setVapidDetails(
        this.vapidSubject,
        this.vapidPublicKey,
        this.vapidPrivateKey,
      );
    }
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.maintenanceTimer = setInterval(() => {
      void this.runDeliveryMaintenance(new Date()).catch((error) => {
        this.logger.warn(
          `Push delivery maintenance failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }, PUSH_DELIVERY_MAINTENANCE_MS);
    this.maintenanceTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
  }

  getPublicKey(): PushPublicKeyResponseDto {
    if (!this.webPushConfigured) {
      throw new ServiceUnavailableException(PUSH_ERROR_MESSAGE.unavailable);
    }
    return { publicKey: this.vapidPublicKey };
  }

  async listSubscriptions(
    userId: string,
  ): Promise<PushSubscriptionResponseDto[]> {
    const subscriptions = await this.subscriptions.find({
      where: { user_id: userId, revoked_at: IsNull() },
      order: { created_at: 'DESC' },
    });
    return subscriptions.map((subscription) =>
      PushSubscriptionResponseDto.fromEntity(subscription),
    );
  }

  async getStatus(userId: string): Promise<PushStatusResponseDto> {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - PUSH_DELIVERY_STALE_MS);
    const [
      subscriptions,
      deliveries,
      pendingRetries,
      exhaustedFailures,
      staleSending,
    ] = await Promise.all([
      this.subscriptions.find({
        where: { user_id: userId, revoked_at: IsNull() },
        order: { created_at: 'DESC' },
      }),
      this.deliveries.find({
        where: { user_id: userId },
        order: { attempted_at: 'DESC' },
        take: PUSH_STATUS_RECENT_DELIVERY_LIMIT,
      }),
      this.deliveries.count({
        where: {
          user_id: userId,
          status: PushDeliveryStatusValue.Failed,
          next_attempt_at: Not(IsNull()),
        },
      }),
      this.deliveries.count({
        where: {
          user_id: userId,
          status: PushDeliveryStatusValue.Failed,
          next_attempt_at: IsNull(),
        },
      }),
      this.deliveries.count({
        where: {
          user_id: userId,
          status: PushDeliveryStatusValue.Sending,
          locked_at: LessThanOrEqual(staleCutoff),
        },
      }),
    ]);
    return PushStatusResponseDto.fromEntities(subscriptions, deliveries, now, {
      pending_retries: pendingRetries,
      exhausted_failures: exhaustedFailures,
      stale_sending: staleSending,
    });
  }

  async upsertSubscription(
    userId: string,
    dto: UpsertPushSubscriptionDto,
    userAgent?: string | null,
  ): Promise<PushSubscriptionResponseDto> {
    const input = this.normalizeSubscriptionInput(dto);
    const now = new Date();
    const endpointHash = input.endpoint ? hashPushValue(input.endpoint) : null;
    const tokenHash = input.token ? hashPushValue(input.token) : null;
    const existing = await this.findExistingSubscription(
      input.provider,
      endpointHash,
      tokenHash,
    );
    await this.assertSubscriptionCapacity(userId, existing);
    const subscription =
      existing ?? this.subscriptions.create({ provider: input.provider });

    Object.assign(subscription, {
      user_id: userId,
      provider: input.provider,
      platform: input.platform,
      endpoint: input.endpoint ?? null,
      endpoint_hash: endpointHash,
      web_push_keys: input.keys ?? null,
      token: input.token ?? null,
      token_hash: tokenHash,
      device_name: input.device_name ?? null,
      user_agent: sanitizeUserAgent(userAgent),
      last_seen_at: now,
      revoked_at: null,
      failure_count: 0,
      last_failure_at: null,
      last_failure_reason: null,
    });

    const saved = await this.subscriptions.save(subscription);
    return PushSubscriptionResponseDto.fromEntity(saved);
  }

  async revokeSubscription(userId: string, id: string): Promise<void> {
    const subscription = await this.subscriptions.findOne({
      where: { id, user_id: userId, revoked_at: IsNull() },
    });
    if (!subscription) {
      throw new NotFoundException(PUSH_ERROR_MESSAGE.notFound);
    }
    subscription.revoked_at = new Date();
    await this.subscriptions.save(subscription);
  }

  async sendNotificationPush(payload: PushNotificationPayload): Promise<void> {
    const activeSubscriptions = await this.subscriptions.find({
      where: { user_id: payload.userId, revoked_at: IsNull() },
      order: { created_at: 'ASC' },
    });
    if (activeSubscriptions.length === 0) {
      return;
    }

    const providerPayload = buildProviderPushPayload(payload);
    const pushBody = JSON.stringify(providerPayload);
    const webSubscriptions = activeSubscriptions.filter(
      (subscription) =>
        subscription.provider === PushProviderValue.WebPush &&
        subscription.endpoint &&
        subscription.web_push_keys,
    );
    const unsupportedSubscriptions = activeSubscriptions.filter(
      (subscription) => subscription.provider !== PushProviderValue.WebPush,
    );
    const tasks: Promise<void>[] = [];

    if (webSubscriptions.length > 0 && !this.webPushConfigured) {
      this.logger.warn(PUSH_ERROR_MESSAGE.unavailable);
      tasks.push(
        ...webSubscriptions.map((subscription) =>
          this.recordSkippedDelivery(
            subscription,
            payload,
            providerPayload,
            PUSH_ERROR_MESSAGE.unavailable,
          ),
        ),
      );
    }
    if (this.webPushConfigured) {
      tasks.push(
        ...webSubscriptions.map((subscription) =>
          this.sendWebPush(subscription, payload, providerPayload, pushBody),
        ),
      );
    }
    tasks.push(
      ...unsupportedSubscriptions.map((subscription) =>
        this.recordSkippedDelivery(
          subscription,
          payload,
          providerPayload,
          PUSH_ERROR_MESSAGE.unsupportedProvider,
        ),
      ),
    );
    await Promise.all(tasks);
  }

  async runDeliveryMaintenance(
    now: Date = new Date(),
  ): Promise<PushMaintenanceResult> {
    const requeued = await this.requeueStaleDeliveries(now);
    const retryResult = await this.retryDueDeliveries(now);
    return { requeued, ...retryResult };
  }

  private async requeueStaleDeliveries(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - PUSH_DELIVERY_STALE_MS);
    const staleDeliveries = await this.deliveries.find({
      where: {
        status: PushDeliveryStatusValue.Sending,
        locked_at: LessThanOrEqual(cutoff),
      },
      order: { locked_at: 'ASC' },
      take: PUSH_DELIVERY_STALE_BATCH_SIZE,
    });

    for (const delivery of staleDeliveries) {
      delivery.status = PushDeliveryStatusValue.Failed;
      delivery.error_message = PUSH_ERROR_MESSAGE.claimExpired;
      delivery.provider_status_code = null;
      delivery.locked_at = null;
      delivery.next_attempt_at =
        (delivery.attempt_count ?? 0) < (delivery.max_attempts ?? 0)
          ? now
          : null;
      await this.deliveries.save(delivery);
    }

    return staleDeliveries.length;
  }

  private async retryDueDeliveries(
    now: Date,
  ): Promise<Omit<PushMaintenanceResult, 'requeued'>> {
    const result = { retried: 0, sent: 0, failed: 0, skipped: 0 };
    if (!this.webPushConfigured) {
      return result;
    }

    const dueDeliveries = await this.deliveries.find({
      where: {
        status: PushDeliveryStatusValue.Failed,
        next_attempt_at: LessThanOrEqual(now),
      },
      relations: ['subscription'],
      order: { next_attempt_at: 'ASC' },
      take: PUSH_DELIVERY_RETRY_BATCH_SIZE,
    });

    for (const delivery of dueDeliveries) {
      if (
        (delivery.attempt_count ?? 0) >=
        (delivery.max_attempts ?? PUSH_DELIVERY_MAX_ATTEMPTS)
      ) {
        continue;
      }

      const claim = await this.deliveries.update(
        {
          id: delivery.id,
          status: PushDeliveryStatusValue.Failed,
          next_attempt_at: LessThanOrEqual(now),
        },
        {
          status: PushDeliveryStatusValue.Sending,
          locked_at: now,
          next_attempt_at: null,
        },
      );
      if (!claim.affected) {
        continue;
      }

      const subscription = delivery.subscription;
      if (!subscription || subscription.revoked_at) {
        delivery.status = PushDeliveryStatusValue.Skipped;
        delivery.error_message = PUSH_ERROR_MESSAGE.inactiveSubscription;
        delivery.locked_at = null;
        delivery.next_attempt_at = null;
        await this.deliveries.save(delivery);
        result.skipped += 1;
        continue;
      }
      if (
        subscription.provider !== PushProviderValue.WebPush ||
        !subscription.endpoint ||
        !subscription.web_push_keys
      ) {
        delivery.status = PushDeliveryStatusValue.Skipped;
        delivery.error_message = PUSH_ERROR_MESSAGE.unsupportedProvider;
        delivery.locked_at = null;
        delivery.next_attempt_at = null;
        await this.deliveries.save(delivery);
        result.skipped += 1;
        continue;
      }
      if (!delivery.push_payload) {
        delivery.status = PushDeliveryStatusValue.Failed;
        delivery.error_message = PUSH_ERROR_MESSAGE.missingPayload;
        delivery.locked_at = null;
        delivery.next_attempt_at = null;
        await this.deliveries.save(delivery);
        result.failed += 1;
        continue;
      }

      delivery.status = PushDeliveryStatusValue.Sending;
      delivery.locked_at = now;
      delivery.next_attempt_at = null;
      const outcome = await this.attemptWebPushDelivery(
        delivery,
        subscription,
        JSON.stringify(delivery.push_payload),
        delivery.kind,
      );
      result.retried += 1;
      result[outcome] += 1;
    }

    return result;
  }

  private async findExistingSubscription(
    provider: PushProvider,
    endpointHash: string | null,
    tokenHash: string | null,
  ): Promise<PushNotificationSubscription | null> {
    if (endpointHash) {
      return this.subscriptions.findOne({
        where: { provider, endpoint_hash: endpointHash },
      });
    }
    if (tokenHash) {
      return this.subscriptions.findOne({
        where: { provider, token_hash: tokenHash },
      });
    }
    return null;
  }

  private normalizeSubscriptionInput(
    dto: UpsertPushSubscriptionDto,
  ): NormalizedPushSubscriptionInput {
    const endpoint = trimOptionalString(dto.endpoint);
    const token = trimOptionalString(dto.token);
    const deviceName = trimOptionalString(dto.device_name);
    const keys = dto.keys
      ? {
          p256dh: trimOptionalString(dto.keys.p256dh),
          auth: trimOptionalString(dto.keys.auth),
        }
      : undefined;

    if (
      dto.provider === PushProviderValue.WebPush &&
      dto.platform !== PushPlatformValue.Web
    ) {
      throw new BadRequestException(PUSH_ERROR_MESSAGE.invalidWebPushPlatform);
    }
    if (dto.provider === PushProviderValue.WebPush) {
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        throw new BadRequestException(PUSH_ERROR_MESSAGE.missingWebKeys);
      }
      assertSafeWebPushEndpoint(endpoint);
      return {
        provider: dto.provider,
        platform: dto.platform,
        endpoint,
        keys: {
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        device_name: deviceName,
      };
    }
    if (!token) {
      throw new BadRequestException(PUSH_ERROR_MESSAGE.missingToken);
    }
    if (
      dto.provider === PushProviderValue.Fcm &&
      dto.platform === PushPlatformValue.Web
    ) {
      throw new BadRequestException(PUSH_ERROR_MESSAGE.invalidFcmPlatform);
    }
    if (
      dto.provider === PushProviderValue.Apns &&
      dto.platform !== PushPlatformValue.Ios
    ) {
      throw new BadRequestException(PUSH_ERROR_MESSAGE.invalidApnsPlatform);
    }
    return {
      provider: dto.provider,
      platform: dto.platform,
      token,
      device_name: deviceName,
    };
  }

  private async assertSubscriptionCapacity(
    userId: string,
    existing: PushNotificationSubscription | null,
  ): Promise<void> {
    if (existing?.user_id === userId && !existing.revoked_at) {
      return;
    }

    const activeCount = await this.subscriptions.count({
      where: { user_id: userId, revoked_at: IsNull() },
    });
    if (activeCount >= PUSH_SUBSCRIPTIONS_PER_USER_LIMIT) {
      throw new BadRequestException(PUSH_ERROR_MESSAGE.tooManySubscriptions);
    }
  }

  private async sendWebPush(
    subscription: PushNotificationSubscription,
    payload: PushNotificationPayload,
    providerPayload: ProviderPushPayload,
    pushBody: string,
  ): Promise<void> {
    const delivery = await this.claimDelivery(
      subscription,
      payload,
      providerPayload,
    );
    if (!delivery) {
      return;
    }

    await this.attemptWebPushDelivery(
      delivery,
      subscription,
      pushBody,
      payload.kind,
    );
  }

  private async attemptWebPushDelivery(
    delivery: PushNotificationDelivery,
    subscription: PushNotificationSubscription,
    pushBody: string,
    kind: NotificationKind,
  ): Promise<'sent' | 'failed'> {
    const attemptStartedAt = new Date();
    delivery.status = PushDeliveryStatusValue.Sending;
    delivery.locked_at = attemptStartedAt;
    delivery.last_attempt_at = attemptStartedAt;
    delivery.next_attempt_at = null;
    delivery.attempt_count = (delivery.attempt_count ?? 0) + 1;
    delivery.max_attempts = delivery.max_attempts ?? PUSH_DELIVERY_MAX_ATTEMPTS;
    await this.deliveries.save(delivery);

    try {
      const result = await webpush.sendNotification(
        {
          endpoint: subscription.endpoint!,
          keys: subscription.web_push_keys!,
        },
        pushBody,
        {
          TTL: PUSH_NOTIFICATION_TTL_SECONDS,
          timeout: PUSH_DELIVERY_TIMEOUT_MS,
          urgency: 'normal',
        },
      );
      delivery.status = PushDeliveryStatusValue.Sent;
      delivery.provider_status_code = result.statusCode ?? null;
      delivery.error_message = null;
      delivery.next_attempt_at = null;
      delivery.locked_at = null;
      subscription.failure_count = 0;
      subscription.last_failure_at = null;
      subscription.last_failure_reason = null;
      await Promise.all([
        this.deliveries.save(delivery),
        this.subscriptions.save(subscription),
      ]);
      return 'sent';
    } catch (error) {
      const statusCode = resolveWebPushStatusCode(error);
      const message = resolveWebPushFailureReason(statusCode);
      delivery.status = PushDeliveryStatusValue.Failed;
      delivery.provider_status_code = statusCode;
      delivery.error_message = message;
      delivery.locked_at = null;
      const canRetry =
        isRetryableWebPushFailure(statusCode) &&
        delivery.attempt_count < delivery.max_attempts;
      delivery.next_attempt_at = canRetry
        ? nextRetryInstant(attemptStartedAt, delivery.attempt_count)
        : null;
      subscription.failure_count = (subscription.failure_count ?? 0) + 1;
      subscription.last_failure_at = new Date();
      subscription.last_failure_reason = message;

      if (statusCode === 404 || statusCode === 410) {
        subscription.revoked_at = new Date();
      }
      this.logger.warn(
        `Web Push delivery failed for ${kind}: ${message}${
          statusCode ? ` (${statusCode})` : ''
        }`,
      );
      await Promise.all([
        this.deliveries.save(delivery),
        this.subscriptions.save(subscription),
      ]);
      return 'failed';
    }
  }

  private async claimDelivery(
    subscription: PushNotificationSubscription,
    payload: PushNotificationPayload,
    providerPayload: ProviderPushPayload,
  ): Promise<PushNotificationDelivery | null> {
    const now = new Date();
    if (payload.dedupeKey) {
      const existing = await this.deliveries.findOne({
        where: {
          subscription_id: subscription.id,
          kind: payload.kind,
          dedupe_key: payload.dedupeKey,
        },
      });
      if (existing) {
        if (!canClaimExistingDelivery(existing, now)) {
          return null;
        }
        Object.assign(existing, {
          user_id: payload.userId,
          notification_id: payload.notificationId ?? existing.notification_id,
          severity: payload.severity ?? existing.severity ?? 'info',
          status: PushDeliveryStatusValue.Sending,
          provider_status_code: null,
          error_message: null,
          push_payload: providerPayload,
          next_attempt_at: null,
          locked_at: now,
          max_attempts: existing.max_attempts ?? PUSH_DELIVERY_MAX_ATTEMPTS,
        });
        return this.deliveries.save(existing);
      }
    }

    try {
      return await this.deliveries.save(
        this.deliveries.create({
          user_id: payload.userId,
          subscription_id: subscription.id,
          notification_id: payload.notificationId ?? null,
          kind: payload.kind,
          severity: payload.severity ?? 'info',
          dedupe_key: payload.dedupeKey ?? null,
          status: PushDeliveryStatusValue.Sending,
          provider_status_code: null,
          error_message: null,
          push_payload: providerPayload,
          attempt_count: 0,
          max_attempts: PUSH_DELIVERY_MAX_ATTEMPTS,
          last_attempt_at: null,
          next_attempt_at: null,
          locked_at: now,
        }),
      );
    } catch (error) {
      if (payload.dedupeKey && isUniqueConstraintError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async recordSkippedDelivery(
    subscription: PushNotificationSubscription,
    payload: PushNotificationPayload,
    providerPayload: ProviderPushPayload,
    reason: string,
  ): Promise<void> {
    const delivery = await this.claimDelivery(
      subscription,
      payload,
      providerPayload,
    );
    if (!delivery) {
      return;
    }
    delivery.status = PushDeliveryStatusValue.Skipped;
    delivery.error_message = reason;
    delivery.provider_status_code = null;
    delivery.next_attempt_at = null;
    delivery.locked_at = null;
    delivery.last_attempt_at = new Date();
    await this.deliveries.save(delivery);
  }
}

function hashPushValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function trimOptionalString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeUserAgent(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, PUSH_USER_AGENT_MAX_LENGTH) : null;
}

function assertSafeWebPushEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BadRequestException(PUSH_ERROR_MESSAGE.invalidEndpoint);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const isUnsafeHostname =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    !hostname.includes('.') ||
    isIP(hostname) !== 0;

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    isUnsafeHostname
  ) {
    throw new BadRequestException(PUSH_ERROR_MESSAGE.invalidEndpoint);
  }
}

function buildProviderPushPayload(
  payload: PushNotificationPayload,
): ProviderPushPayload {
  const copy = buildPushCopy(payload);
  return {
    title: copy.title,
    body: copy.body,
    icon: '/brand/ritora-icon-192.png',
    badge: '/brand/ritora-icon-192.png',
    tag: payload.dedupeKey ?? payload.kind,
    data: {
      kind: payload.kind,
      severity: payload.severity ?? 'info',
      deepLink: payload.deepLink ?? '/notifications',
      notificationId: payload.notificationId ?? null,
    },
  };
}

function canClaimExistingDelivery(
  delivery: PushNotificationDelivery,
  now: Date,
): boolean {
  if (
    delivery.status === PushDeliveryStatusValue.Sent ||
    delivery.status === PushDeliveryStatusValue.Skipped
  ) {
    return false;
  }

  if (delivery.status === PushDeliveryStatusValue.Sending) {
    return isStaleSendingDelivery(delivery, now);
  }

  if (delivery.status === PushDeliveryStatusValue.Failed) {
    if (
      (delivery.attempt_count ?? 0) >=
      (delivery.max_attempts ?? PUSH_DELIVERY_MAX_ATTEMPTS)
    ) {
      return false;
    }
    return Boolean(
      delivery.next_attempt_at &&
      delivery.next_attempt_at.getTime() <= now.getTime(),
    );
  }

  return false;
}

function isStaleSendingDelivery(
  delivery: PushNotificationDelivery,
  now: Date,
): boolean {
  const lockedAt =
    delivery.locked_at ?? delivery.last_attempt_at ?? delivery.attempted_at;
  if (!lockedAt) {
    return true;
  }
  return now.getTime() - lockedAt.getTime() > PUSH_DELIVERY_STALE_MS;
}

function nextRetryInstant(attemptStartedAt: Date, attemptCount: number): Date {
  const backoffSeconds =
    PUSH_DELIVERY_BACKOFF_SECONDS[
      Math.min(attemptCount - 1, PUSH_DELIVERY_BACKOFF_SECONDS.length - 1)
    ] ??
    PUSH_DELIVERY_BACKOFF_SECONDS[PUSH_DELIVERY_BACKOFF_SECONDS.length - 1];
  return new Date(attemptStartedAt.getTime() + backoffSeconds * 1000);
}

function isRetryableWebPushFailure(statusCode: number | null): boolean {
  if (statusCode === null) {
    return true;
  }
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function resolveWebPushStatusCode(error: unknown): number | null {
  if (error instanceof WebPushError) {
    return error.statusCode;
  }
  const maybeStatus = (error as { statusCode?: unknown })?.statusCode;
  return typeof maybeStatus === 'number' ? maybeStatus : null;
}

function resolveWebPushFailureReason(statusCode: number | null): string {
  if (statusCode === 404 || statusCode === 410) {
    return PUSH_ERROR_MESSAGE.deliveryExpired;
  }
  if (statusCode === 401 || statusCode === 403) {
    return PUSH_ERROR_MESSAGE.deliveryForbidden;
  }
  if (statusCode === 400 || statusCode === 413) {
    return PUSH_ERROR_MESSAGE.deliveryBadRequest;
  }
  if (statusCode === 429) {
    return PUSH_ERROR_MESSAGE.deliveryRateLimited;
  }
  if (statusCode === null || statusCode === 408 || statusCode >= 500) {
    return PUSH_ERROR_MESSAGE.deliveryTransient;
  }
  return PUSH_ERROR_MESSAGE.deliveryFailed;
}

function buildPushCopy(payload: PushNotificationPayload): PushCopy {
  const language = normalizeLanguage(payload.language ?? DEFAULT_LANGUAGE);
  if (
    payload.kind === 'product_nearing_expiry' ||
    payload.kind === 'product_expired'
  ) {
    return buildProductExpiryPushCopy(payload, language);
  }
  return (
    GENERIC_PUSH_COPY[language][payload.kind] ??
    GENERIC_PUSH_COPY.en[payload.kind] ?? {
      title: payload.titleKey,
      body: payload.bodyKey,
    }
  );
}

function buildProductExpiryPushCopy(
  payload: PushNotificationPayload,
  language: AppLanguage,
): PushCopy {
  const productName =
    getPayloadString(payload.payload, 'productName') ??
    getPayloadString(payload.payload, 'name') ??
    (language === 'sv'
      ? 'En produkt'
      : language === 'es'
        ? 'Un producto'
        : 'A product');
  const expiresDate = formatExpiryDate(
    getPayloadString(payload.payload, 'expiresAt'),
    language,
  );
  const daysUntilExpiry = getPayloadNumber(payload.payload, 'daysUntilExpiry');

  if (payload.kind === 'product_expired') {
    if (language === 'sv') {
      return {
        title: 'Produkt har gått ut',
        body: `${productName} gick ut den ${expiresDate}.`,
      };
    }

    if (language === 'es') {
      return {
        title: 'Producto caducado',
        body: `${productName} caducó el ${expiresDate}.`,
      };
    }

    return {
      title: 'Product expired',
      body: `${productName} expired on ${expiresDate}.`,
    };
  }

  if (daysUntilExpiry === null) {
    if (language === 'sv') {
      return {
        title: 'Produkt nära utgång',
        body: `${productName} går ut den ${expiresDate}.`,
      };
    }

    if (language === 'es') {
      return {
        title: 'Producto cerca de caducar',
        body: `${productName} caduca el ${expiresDate}.`,
      };
    }

    return {
      title: 'Product close to expiry',
      body: `${productName} expires on ${expiresDate}.`,
    };
  }

  if (language === 'sv') {
    const dayLabel = daysUntilExpiry === 1 ? 'dag' : 'dagar';
    return {
      title: 'Produkt nära utgång',
      body: `${productName} går ut om ${daysUntilExpiry} ${dayLabel}, den ${expiresDate}.`,
    };
  }

  if (language === 'es') {
    const dayLabel = daysUntilExpiry === 1 ? 'día' : 'días';
    return {
      title: 'Producto cerca de caducar',
      body: `${productName} caduca en ${daysUntilExpiry} ${dayLabel}, el ${expiresDate}.`,
    };
  }

  const dayLabel = daysUntilExpiry === 1 ? 'day' : 'days';
  return {
    title: 'Product close to expiry',
    body: `${productName} expires in ${daysUntilExpiry} ${dayLabel}, on ${expiresDate}.`,
  };
}

function getPayloadString(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getPayloadNumber(
  payload: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = payload?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatExpiryDate(value: string | null, language: AppLanguage): string {
  if (!value) {
    if (language === 'sv') return 'ett okänt datum';
    if (language === 'es') return 'una fecha desconocida';
    return 'an unknown date';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    if (language === 'sv') return 'ett okänt datum';
    if (language === 'es') return 'una fecha desconocida';
    return 'an unknown date';
  }
  const locale =
    language === 'sv' ? 'sv-SE' : language === 'es' ? 'es-ES' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(parsed);
}
