import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PushPlatform,
  PushPlatformValue,
  PushProvider,
  PushProviderValue,
  PushNotificationSubscription,
} from '../entities/push-notification-subscription.entity';
import {
  PushDeliveryStatus,
  PushDeliveryStatusValue,
  PushNotificationDelivery,
} from '../entities/push-notification-delivery.entity';

const PUSH_ENDPOINT_MAX_LENGTH = 2048;
const PUSH_KEY_MAX_LENGTH = 255;
const PUSH_TOKEN_MAX_LENGTH = 4096;
const PUSH_DEVICE_NAME_MAX_LENGTH = 120;

export class PushPublicKeyResponseDto {
  @ApiProperty()
  publicKey: string;
}

export class WebPushKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PUSH_KEY_MAX_LENGTH)
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PUSH_KEY_MAX_LENGTH)
  auth: string;
}

export class UpsertPushSubscriptionDto {
  @IsIn(Object.values(PushProviderValue))
  provider: PushProvider;

  @IsIn(Object.values(PushPlatformValue))
  platform: PushPlatform;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PUSH_ENDPOINT_MAX_LENGTH)
  endpoint?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WebPushKeysDto)
  keys?: WebPushKeysDto;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PUSH_TOKEN_MAX_LENGTH)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PUSH_DEVICE_NAME_MAX_LENGTH)
  device_name?: string;
}

export class PushSubscriptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: Object.values(PushProviderValue) })
  provider: PushProvider;

  @ApiProperty({ enum: Object.values(PushPlatformValue) })
  platform: PushPlatform;

  @ApiPropertyOptional()
  endpoint_hash?: string;

  @ApiPropertyOptional()
  device_name?: string;

  @ApiProperty()
  last_seen_at: string | null;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  failure_count: number;

  @ApiProperty()
  last_failure_at: string | null;

  @ApiPropertyOptional()
  last_failure_reason?: string;

  static fromEntity(
    subscription: PushNotificationSubscription,
  ): PushSubscriptionResponseDto {
    const dto = new PushSubscriptionResponseDto();
    dto.id = subscription.id;
    dto.provider = subscription.provider;
    dto.platform = subscription.platform;
    dto.endpoint_hash = subscription.endpoint_hash ?? undefined;
    dto.device_name = subscription.device_name ?? undefined;
    dto.last_seen_at = subscription.last_seen_at?.toISOString() ?? null;
    dto.created_at = (subscription.created_at ?? new Date()).toISOString();
    dto.failure_count = subscription.failure_count ?? 0;
    dto.last_failure_at = subscription.last_failure_at?.toISOString() ?? null;
    dto.last_failure_reason = subscription.last_failure_reason ?? undefined;
    return dto;
  }
}

export class PushDeliveryStatusCountsDto {
  @ApiProperty()
  sending: number;

  @ApiProperty()
  sent: number;

  @ApiProperty()
  failed: number;

  @ApiProperty()
  skipped: number;
}

export class PushStatusResponseDto {
  @ApiProperty()
  active_subscriptions: number;

  @ApiProperty()
  web_push_subscriptions: number;

  @ApiProperty()
  mobile_subscriptions: number;

  @ApiProperty()
  failing_subscriptions: number;

  @ApiProperty({ type: PushDeliveryStatusCountsDto })
  recent_delivery_statuses: PushDeliveryStatusCountsDto;

  @ApiProperty()
  pending_retries: number;

  @ApiProperty()
  exhausted_failures: number;

  @ApiProperty()
  stale_sending: number;

  static fromEntities(
    subscriptions: PushNotificationSubscription[],
    deliveries: PushNotificationDelivery[],
    now: Date,
    counts?: {
      pending_retries: number;
      exhausted_failures: number;
      stale_sending: number;
    },
  ): PushStatusResponseDto {
    const dto = new PushStatusResponseDto();
    dto.active_subscriptions = subscriptions.length;
    dto.web_push_subscriptions = subscriptions.filter(
      (subscription) => subscription.provider === PushProviderValue.WebPush,
    ).length;
    dto.mobile_subscriptions = subscriptions.filter(
      (subscription) => subscription.provider !== PushProviderValue.WebPush,
    ).length;
    dto.failing_subscriptions = subscriptions.filter(
      (subscription) => (subscription.failure_count ?? 0) > 0,
    ).length;

    dto.recent_delivery_statuses = countDeliveryStatuses(deliveries);
    dto.pending_retries =
      counts?.pending_retries ??
      deliveries.filter(
        (delivery) =>
          delivery.status === PushDeliveryStatusValue.Failed &&
          Boolean(delivery.next_attempt_at) &&
          (delivery.attempt_count ?? 0) < (delivery.max_attempts ?? 0),
      ).length;
    dto.exhausted_failures =
      counts?.exhausted_failures ??
      deliveries.filter(
        (delivery) =>
          delivery.status === PushDeliveryStatusValue.Failed &&
          (!delivery.next_attempt_at ||
            (delivery.attempt_count ?? 0) >= (delivery.max_attempts ?? 0)),
      ).length;
    dto.stale_sending =
      counts?.stale_sending ??
      deliveries.filter(
        (delivery) =>
          delivery.status === PushDeliveryStatusValue.Sending &&
          Boolean(delivery.locked_at) &&
          now.getTime() - delivery.locked_at!.getTime() > 10 * 60 * 1000,
      ).length;
    return dto;
  }
}

function countDeliveryStatuses(
  deliveries: PushNotificationDelivery[],
): PushDeliveryStatusCountsDto {
  const counts: Record<PushDeliveryStatus, number> = {
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  for (const delivery of deliveries) {
    counts[delivery.status] += 1;
  }
  return counts;
}
