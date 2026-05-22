import { Injectable } from '@nestjs/common';
import {
  INSIGHT_KNOWLEDGE_BASE,
  type KnowledgeBaseEntry,
} from './knowledge-base.entries';
import type { InsightSourceCitation } from '../insight-types';

@Injectable()
export class KnowledgeBaseService {
  private readonly entriesById = new Map(
    INSIGHT_KNOWLEDGE_BASE.map((entry) => [entry.id, entry]),
  );

  resolve(id: string): KnowledgeBaseEntry | null {
    return this.entriesById.get(id) ?? null;
  }

  resolveMany(ids: readonly string[]): InsightSourceCitation[] {
    const uniqueIds = [...new Set(ids)];
    return uniqueIds
      .map((id) => this.resolve(id))
      .filter((entry): entry is KnowledgeBaseEntry => !!entry)
      .map((entry) => ({
        id: entry.id,
        title_key: entry.title_key,
        organization: entry.organization,
        summary_key: entry.summary_key,
        url: entry.url,
        evidence_grade: entry.evidence_grade,
        last_verified: entry.last_verified,
      }));
  }

  all(): readonly KnowledgeBaseEntry[] {
    return INSIGHT_KNOWLEDGE_BASE;
  }
}
