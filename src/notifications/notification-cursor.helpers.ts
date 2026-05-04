import { BadRequestException } from '@nestjs/common';
import { Brackets, SelectQueryBuilder } from 'typeorm';
import { decodeCursor, encodeCursor } from '../common/utils/cursor-pagination';
import { InAppNotification } from './entities/in-app-notification.entity';

type NotificationCursorTuple = [number, string, string];

const NOTIFICATION_CURSOR_FINGERPRINT_PREFIX = 'notifications:v1';
export const NOTIFICATION_READ_BUCKET_SQL =
  'CASE WHEN notification.read_at IS NULL THEN 0 ELSE 1 END';

export function notificationCursorFingerprint(userId: string): string {
  return `${NOTIFICATION_CURSOR_FINGERPRINT_PREFIX}:${userId}`;
}

export function applyNotificationCursor(
  queryBuilder: SelectQueryBuilder<InAppNotification>,
  cursor: string | undefined,
  fingerprint: string,
): void {
  if (!cursor) {
    return;
  }

  const decoded = decodeCursor(cursor);
  if (decoded.fingerprint !== fingerprint) {
    throw new BadRequestException('Cursor does not match this request');
  }

  const [bucket, createdAt, id] = decoded.tuple;
  if (
    (bucket !== 0 && bucket !== 1) ||
    typeof createdAt !== 'string' ||
    typeof id !== 'string'
  ) {
    throw new BadRequestException('Invalid cursor');
  }

  queryBuilder.andWhere(
    new Brackets((qb) => {
      qb.where(`${NOTIFICATION_READ_BUCKET_SQL} > :cursorBucket`, {
        cursorBucket: bucket,
      })
        .orWhere(
          `${NOTIFICATION_READ_BUCKET_SQL} = :cursorBucket AND notification.created_at < :cursorCreatedAt`,
          { cursorBucket: bucket, cursorCreatedAt: createdAt },
        )
        .orWhere(
          `${NOTIFICATION_READ_BUCKET_SQL} = :cursorBucket AND notification.created_at = :cursorCreatedAt AND notification.id < :cursorId`,
          { cursorBucket: bucket, cursorCreatedAt: createdAt, cursorId: id },
        );
    }),
  );
}

export function buildNotificationNextCursor(
  item: InAppNotification | undefined,
  fingerprint: string,
  hasMore: boolean,
): string | null {
  if (!hasMore || !item) {
    return null;
  }

  return encodeCursor({
    fingerprint,
    tuple: notificationCursorTuple(item),
  });
}

function notificationCursorTuple(
  item: InAppNotification,
): NotificationCursorTuple {
  return [item.read_at ? 1 : 0, toCursorDate(item.created_at), item.id];
}

function toCursorDate(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
