import { BadRequestException } from '@nestjs/common';
import {
  CONCERN_KEYS,
  ConcernKey,
  REACTION_REPORT_LOCATIONS,
  REACTION_REPORT_ONSETS,
  REACTION_REPORT_RED_FLAGS,
  REACTION_REPORT_SEVERITIES,
  REACTION_REPORT_SYMPTOMS,
  REACTION_REPORT_TRIGGERS,
  RatingsPayload,
  ReactionReportPayload,
  RecentChangePayload,
  SKIN_JOURNAL_PHOTO_ANGLES,
  type Angle,
} from './skin-journal.constants';
import { UpsertEntryDto } from './dto/upsert-entry.dto';

const RECENT_CHANGE_KINDS: ReadonlySet<RecentChangePayload['kind']> = new Set<
  RecentChangePayload['kind']
>([
  'started_new_product',
  'stopped_a_product',
  'changed_frequency',
  'got_a_treatment',
  'felt_unwell',
  'travelled',
  'other',
]);
const PHOTO_ANGLES = new Set<Angle>(SKIN_JOURNAL_PHOTO_ANGLES);
const REACTION_SYMPTOMS = new Set<string>(REACTION_REPORT_SYMPTOMS);
const REACTION_SEVERITIES = new Set<string>(REACTION_REPORT_SEVERITIES);
const REACTION_ONSETS = new Set<string>(REACTION_REPORT_ONSETS);
const REACTION_LOCATIONS = new Set<string>(REACTION_REPORT_LOCATIONS);
const REACTION_RED_FLAGS = new Set<string>(REACTION_REPORT_RED_FLAGS);
const REACTION_TRIGGERS = new Set<string>(REACTION_REPORT_TRIGGERS);
const INVALID_JSON_PAYLOAD_KEY = '__invalid_json_payload__';

export function normalizeUpsertEntryBody(body: UpsertEntryDto): UpsertEntryDto {
  const record = body as Record<string, unknown>;
  const normalized: UpsertEntryDto = { ...body };

  normalized.is_pre_routine = parseOptionalBoolean(record.is_pre_routine);
  normalized.sweat_exercise_today = parseOptionalBoolean(
    record.sweat_exercise_today,
  );
  normalized.skip_check_in = parseOptionalBoolean(record.skip_check_in);
  normalized.photo_processing_consent = parseOptionalBoolean(
    record.photo_processing_consent,
  );
  normalized.concern_focus = parseOptionalStringArray(record.concern_focus);
  normalized.remove_photo_angles = parseOptionalPhotoAngleArray(
    record.remove_photo_angles,
  );
  normalized.ratings = parseOptionalRatings(record.ratings, record);
  normalized.recent_change = parseOptionalRecentChange(record.recent_change);
  normalized.reaction_report = parseOptionalReactionReport(
    record.reaction_report,
  );

  return normalized;
}

function parseOptionalPhotoAngleArray(value: unknown): Angle[] | undefined {
  const parsed = parseOptionalStringArray(value);
  if (parsed === undefined) return undefined;
  if (!parsed.every((item): item is Angle => PHOTO_ANGLES.has(item as Angle))) {
    throw new BadRequestException('Invalid photo angle value');
  }
  return [...new Set(parsed)];
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  throw new BadRequestException('Invalid boolean value');
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseJson(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed;
    }
  }
  throw new BadRequestException('Invalid string array value');
}

function parseOptionalRatings(
  value: unknown,
  record: Record<string, unknown>,
): RatingsPayload | undefined {
  const source =
    value === undefined ? extractNestedRatings(record) : parseObjectish(value);
  if (source === undefined) {
    return undefined;
  }
  const ratings: RatingsPayload = {};
  for (const key of CONCERN_KEYS) {
    const candidate = source[key];
    if (candidate === undefined || candidate === null || candidate === '') {
      continue;
    }
    const parsed = Number(candidate);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      throw new BadRequestException(`Invalid rating for ${key}`);
    }
    ratings[key] = parsed as RatingsPayload[ConcernKey];
  }
  return ratings;
}

function extractNestedRatings(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const ratings: Record<string, unknown> = {};
  let found = false;
  for (const key of CONCERN_KEYS) {
    const dotKey = `ratings.${key}`;
    const bracketKey = `ratings[${key}]`;
    if (record[dotKey] !== undefined) {
      ratings[key] = record[dotKey];
      found = true;
    } else if (record[bracketKey] !== undefined) {
      ratings[key] = record[bracketKey];
      found = true;
    }
  }
  return found ? ratings : undefined;
}

function parseOptionalRecentChange(
  value: unknown,
): RecentChangePayload | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = parseObjectish(value);
  if (
    !parsed ||
    typeof parsed.kind !== 'string' ||
    !RECENT_CHANGE_KINDS.has(parsed.kind as RecentChangePayload['kind'])
  ) {
    throw new BadRequestException('Invalid recent_change payload');
  }
  return {
    kind: parsed.kind as RecentChangePayload['kind'],
    related_inventory_product_id:
      typeof parsed.related_inventory_product_id === 'string'
        ? parsed.related_inventory_product_id
        : null,
    note: typeof parsed.note === 'string' ? parsed.note : null,
  };
}

function parseOptionalReactionReport(
  value: unknown,
): ReactionReportPayload | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = parseObjectish(value);
  if (!parsed) {
    throw new BadRequestException('Invalid reaction_report payload');
  }
  const symptoms = parseEnumArray(
    parsed.symptoms,
    REACTION_SYMPTOMS,
    'reaction_report.symptoms',
  );
  if (symptoms.length === 0) {
    throw new BadRequestException('reaction_report symptoms are required');
  }
  if (
    typeof parsed.severity !== 'string' ||
    !REACTION_SEVERITIES.has(parsed.severity)
  ) {
    throw new BadRequestException('Invalid reaction_report severity');
  }

  return {
    symptoms: symptoms as ReactionReportPayload['symptoms'],
    severity: parsed.severity as ReactionReportPayload['severity'],
    onset:
      typeof parsed.onset === 'string' && REACTION_ONSETS.has(parsed.onset)
        ? (parsed.onset as ReactionReportPayload['onset'])
        : null,
    locations:
      parsed.locations === undefined
        ? []
        : (parseEnumArray(
            parsed.locations,
            REACTION_LOCATIONS,
            'reaction_report.locations',
          ) as ReactionReportPayload['locations']),
    red_flags:
      parsed.red_flags === undefined
        ? []
        : (parseEnumArray(
            parsed.red_flags,
            REACTION_RED_FLAGS,
            'reaction_report.red_flags',
          ) as ReactionReportPayload['red_flags']),
    suspected_trigger:
      typeof parsed.suspected_trigger === 'string' &&
      REACTION_TRIGGERS.has(parsed.suspected_trigger)
        ? (parsed.suspected_trigger as ReactionReportPayload['suspected_trigger'])
        : null,
    note: typeof parsed.note === 'string' ? parsed.note.slice(0, 1000) : null,
  };
}

function parseEnumArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  const result: unknown[] = [...new Set<unknown>(value)];
  if (!result.every((item) => typeof item === 'string' && allowed.has(item))) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return result as string[];
}

function parseObjectish(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (isPlainRecord(value)) {
    if (isInvalidJsonPayload(value)) {
      throw new BadRequestException('Invalid JSON payload');
    }
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseJson(value);
    if (isPlainRecord(parsed)) {
      if (isInvalidJsonPayload(parsed)) {
        throw new BadRequestException('Invalid JSON payload');
      }
      return parsed;
    }
  }
  throw new BadRequestException('Invalid object payload');
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new BadRequestException('Invalid JSON payload');
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInvalidJsonPayload(value: Record<string, unknown>): boolean {
  return value[INVALID_JSON_PAYLOAD_KEY] === true;
}
