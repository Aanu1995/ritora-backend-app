import type {
  ApplicationGuidance,
  CatalogueIdentity,
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  LookupEvidence,
  LookupWarningCode,
  ManufacturerInfo,
} from '../shelf/shelf.types';

export type DiscoveredSuggestion = {
  id: string;
  source: CatalogueSource;
  brand: string;
  name: string;
  category: CatalogueIdentity['category'];
  imageUrls: string[];
  sizeMl: number | null;
  barcode: string | null;
  confidence: LookupConfidence;
  reviewRequired: boolean;
};

export type ResolvedProductDraft = {
  identity: Partial<CatalogueIdentity>;
  guidance: Partial<ApplicationGuidance>;
  manufacturer: Partial<ManufacturerInfo>;
  provenance: DataProvenance;
  source: CatalogueSource;
  confidence: LookupConfidence;
  reviewRequired: boolean;
  warnings: LookupWarningCode[];
  evidence: LookupEvidence[];
  cacheKey: {
    source: CatalogueSource;
    id: string | null;
    url: string | null;
  };
  rawSource: Record<string, unknown>;
};

export type OfficialPageExtraction = {
  identity: Partial<CatalogueIdentity>;
  guidance: Partial<ApplicationGuidance>;
  manufacturer: Partial<ManufacturerInfo>;
  evidence: LookupEvidence[];
  rawSource: Record<string, unknown>;
  textExcerpt: string | null;
};
