import { JournalEntryResponseDto } from './dto/journal-entry-response.dto';
import { JournalEventResponseDto } from './dto/event-response.dto';
import { JournalInsightResponseDto } from './dto/insight-response.dto';
import { SimplificationResponseDto } from './dto/simplification-response.dto';
import {
  ResolvedWrappedManifest,
  WrappedResponseDto,
} from './dto/wrapped-response.dto';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { SkinJournalEntryPhoto } from './entities/skin-journal-entry-photo.entity';
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import {
  SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
  SkinJournalExportEntryRecord,
} from './skin-journal.constants';

type SignedPhotoUrlResolver = (
  objectKey: string | null,
  options?: { ttlSeconds?: number },
) => string | null;

export function toExportEntryRecord(
  entry: SkinJournalEntry,
  photos: SkinJournalEntryPhoto[] = [],
): SkinJournalExportEntryRecord {
  const frontPhoto =
    photos.find((photo) => photo.angle === SKIN_JOURNAL_FRONT_PHOTO_ANGLE) ??
    null;
  const photoObjectKey = frontPhoto?.photo_object_key ?? entry.photo_object_key;
  const exportedPhotos = photos.map((photo) => ({
    angle: photo.angle,
    photo_object_key: photo.photo_object_key,
    photo_url: null,
    width: photo.photo_width,
    height: photo.photo_height,
  }));
  return {
    ...toRecord(
      JournalEntryResponseDto.fromEntity(
        entry,
        null,
        exportedPhotos.map((photo) => ({
          angle: photo.angle,
          photo_url: '',
          width: photo.width,
          height: photo.height,
        })),
      ),
    ),
    photo_object_key: photoObjectKey,
    photo_url: null,
    photos: exportedPhotos,
  };
}

export function toExportEventRecord(
  event: SkinJournalEvent,
): Record<string, unknown> {
  return toRecord(JournalEventResponseDto.fromEntity(event));
}

export function toExportInsightRecord(
  insight: SkinJournalInsight,
): Record<string, unknown> {
  return toRecord(JournalInsightResponseDto.fromEntity(insight));
}

export function toExportSimplificationRecord(
  simplification: RoutineSimplificationEvent,
): Record<string, unknown> {
  return toRecord(SimplificationResponseDto.fromEntity(simplification));
}

export function toWrappedExportRecord(
  wrapped: SkinJournalWrapped,
): Record<string, unknown> {
  return {
    id: wrapped.id,
    period_kind: wrapped.period_kind,
    period_start: wrapped.period_start,
    period_end: wrapped.period_end,
    status: wrapped.status,
    manifest: wrapped.manifest
      ? {
          ...wrapped.manifest,
          entries: wrapped.manifest.entries.map((entry) => ({
            ...entry,
            photo_url: null,
          })),
        }
      : null,
    photo_count: wrapped.manifest?.entries?.length ?? 0,
    generated_at: wrapped.generated_at,
    error: wrapped.error,
  };
}

export function toWrappedResponseDto(
  wrapped: SkinJournalWrapped,
  resolvePhotoUrl: SignedPhotoUrlResolver,
): WrappedResponseDto {
  if (!wrapped.manifest) return WrappedResponseDto.fromEntity(wrapped, null);
  const resolved: ResolvedWrappedManifest = {
    ...wrapped.manifest,
    entries: wrapped.manifest.entries.map((entry) => ({
      ...entry,
      photo_url: resolvePhotoUrl(entry.photo_object_key) ?? '',
    })),
  };
  return WrappedResponseDto.fromEntity(wrapped, resolved);
}

function toRecord(value: object): Record<string, unknown> {
  return { ...value };
}
