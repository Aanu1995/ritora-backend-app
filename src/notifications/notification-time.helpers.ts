import { Temporal } from '@js-temporal/polyfill';
import { resolveSkinJournalTimeZone } from '../skin-journal/skin-journal.utils';
import { User } from '../users/entities/user.entity';
import { NotificationKind } from './entities/in-app-notification.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';

export function isDelayedByQuietHours(
  prefs: UserNotificationPreference,
  kind: NotificationKind,
  user: User | null,
  now: Date,
): boolean {
  if (!prefs.quiet_hours_enabled || isQuietHoursExempt(kind)) {
    return false;
  }
  const timeZone = resolveSkinJournalTimeZone(user?.time_zone ?? null);
  return isWithinQuietHours(
    now,
    timeZone,
    prefs.quiet_hours_start,
    prefs.quiet_hours_end,
  );
}

export function nextQuietHoursEligibleInstant(
  now: Date,
  timeZone: string,
  start: string,
  end: string,
): Date {
  const startMinutes = parseClockMinutes(start);
  const endMinutes = parseClockMinutes(end);
  const current = Temporal.Instant.fromEpochMilliseconds(
    now.getTime(),
  ).toZonedDateTimeISO(timeZone);
  const endTime = clockMinutesToPlainTime(endMinutes);
  const candidateDate =
    startMinutes < endMinutes || current.hour * 60 + current.minute < endMinutes
      ? current.toPlainDate()
      : current.toPlainDate().add({ days: 1 });
  const deliverAt = candidateDate
    .toPlainDateTime(endTime)
    .toZonedDateTime(timeZone);
  return new Date(deliverAt.epochMilliseconds);
}

export function isReminderDue(
  now: Date,
  timeZone: string,
  reminderTime: string,
): boolean {
  const reminderMinutes = parseClockMinutes(reminderTime);
  const localMinutes = minutesInTimeZone(now, timeZone);
  const delta = localMinutes - reminderMinutes;
  return delta >= 0 && delta < 15;
}

export function localDayUtcRange(
  localDate: string,
  timeZone: string,
): { start: Date; end: Date } {
  const startZonedDateTime = Temporal.PlainDate.from(localDate)
    .toPlainDateTime(Temporal.PlainTime.from('00:00'))
    .toZonedDateTime(timeZone);
  const start = startZonedDateTime.toInstant();
  const end = startZonedDateTime
    .add({ days: 1 })
    .toInstant()
    .subtract({ milliseconds: 1 });
  return {
    start: new Date(start.epochMilliseconds),
    end: new Date(end.epochMilliseconds),
  };
}

function isQuietHoursExempt(kind: NotificationKind): boolean {
  return kind === 'reaction_detected';
}

function isWithinQuietHours(
  now: Date,
  timeZone: string,
  start: string,
  end: string,
): boolean {
  const startMinutes = parseClockMinutes(start);
  const endMinutes = parseClockMinutes(end);
  if (startMinutes === endMinutes) return false;
  const localMinutes = minutesInTimeZone(now, timeZone);
  if (startMinutes < endMinutes) {
    return localMinutes >= startMinutes && localMinutes < endMinutes;
  }
  return localMinutes >= startMinutes || localMinutes < endMinutes;
}

function clockMinutesToPlainTime(minutes: number): Temporal.PlainTime {
  return Temporal.PlainTime.from({
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  });
}

function parseClockMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function minutesInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? 0,
  );
  return hour * 60 + minute;
}
