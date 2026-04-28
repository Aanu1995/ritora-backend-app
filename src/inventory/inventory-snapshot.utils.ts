import {
  normalizeApplicationGuidanceSnapshot,
  normalizeCatalogueIdentitySnapshot,
  normalizeManufacturerInfoSnapshot,
  normalizeUserFieldsSnapshot,
} from '../shelf/shelf-payload-normalizer';
import {
  type ApplicationGuidance,
  type CatalogueIdentity,
  DataProvenance,
  type ManufacturerInfo,
  ShelfStatus,
  type ShelfProductSnapshot,
  type UserFields,
} from '../shelf/shelf.types';
import { CreateInventoryProductDto } from './dto/create-inventory-product.dto';
import { UpdateInventoryProductDto } from './dto/update-inventory-product.dto';

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

export function normalizeInventorySearchValue(
  value: string | null | undefined,
): string {
  return value?.trim().toLowerCase() ?? '';
}

export function buildInventorySearchDocument(
  snapshot: ShelfProductSnapshot,
): string {
  const parts = [
    snapshot.identity.brand,
    snapshot.identity.name,
    snapshot.identity.category,
    snapshot.identity.description,
    ...snapshot.identity.benefits,
    ...snapshot.identity.suitedFor,
    ...snapshot.identity.inciIngredients,
    snapshot.manufacturer.brand,
    snapshot.manufacturer.parentCompany,
    snapshot.userFields.purchasedFrom,
  ];

  return parts
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function mergeInventorySnapshot(
  existing: ShelfProductSnapshot,
  patch: UpdateInventoryProductDto,
): ShelfProductSnapshot {
  return {
    identity: {
      ...existing.identity,
      ...(patch.identity ?? {}),
    },
    guidance: {
      ...existing.guidance,
      ...(patch.guidance ?? {}),
    },
    manufacturer: {
      ...existing.manufacturer,
      ...(patch.manufacturer ?? {}),
      brand:
        patch.manufacturer?.brand ??
        existing.manufacturer.brand ??
        existing.identity.brand,
    },
    userFields: {
      ...existing.userFields,
      ...(patch.userFields ?? {}),
    },
    status: patch.status ?? existing.status,
    provenance: patch.provenance ?? existing.provenance,
  };
}

export function toInventorySnapshotFromCreateDto(
  dto: CreateInventoryProductDto,
): ShelfProductSnapshot {
  const identity: CatalogueIdentity = {
    brand: dto.identity.brand,
    name: dto.identity.name,
    category: dto.identity.category,
    barcode: dto.identity.barcode ?? null,
    imageUrls: [...dto.identity.imageUrls],
    sizeMl: dto.identity.sizeMl,
    description: dto.identity.description,
    benefits: [...dto.identity.benefits],
    suitedFor: [...dto.identity.suitedFor],
    inciIngredients: [...dto.identity.inciIngredients],
    inciLastConfirmedAt: dto.identity.inciLastConfirmedAt ?? null,
  };

  const guidance: ApplicationGuidance = {
    applicationMethod: dto.guidance.applicationMethod ?? null,
    quantity: dto.guidance.quantity ?? null,
    steps: [...dto.guidance.steps],
    cautions: [...dto.guidance.cautions],
    waitMinutes: dto.guidance.waitMinutes ?? null,
  };

  const manufacturer: ManufacturerInfo = {
    brand: dto.manufacturer.brand ?? dto.identity.brand,
    parentCompany: dto.manufacturer.parentCompany ?? null,
    countryOfOrigin: dto.manufacturer.countryOfOrigin ?? null,
    countryOfManufacture: dto.manufacturer.countryOfManufacture ?? null,
    supportEmail: dto.manufacturer.supportEmail ?? null,
    productUrl: dto.manufacturer.productUrl ?? null,
    websiteUrl: dto.manufacturer.websiteUrl ?? null,
  };

  const userFields: UserFields = {
    openedAt: dto.userFields.openedAt ?? null,
    expiresAt: dto.userFields.expiresAt ?? null,
    periodAfterOpeningMonths: dto.userFields.periodAfterOpeningMonths ?? null,
    pricePaid: dto.userFields.pricePaid ?? null,
    pricePaidCurrency: dto.userFields.pricePaidCurrency ?? null,
    purchasedFrom: dto.userFields.purchasedFrom ?? null,
    personalNotes: dto.userFields.personalNotes ?? null,
    preferredTimeOfDay: dto.userFields.preferredTimeOfDay ?? null,
  };

  return {
    identity,
    guidance,
    manufacturer,
    userFields,
    status: dto.status ?? ShelfStatus.Active,
    provenance: dto.provenance ?? DataProvenance.PhotoLookup,
  };
}

export function normalizeInventorySnapshot(
  draft: ShelfProductSnapshot,
): ShelfProductSnapshot {
  const identity = normalizeCatalogueIdentitySnapshot({
    ...draft.identity,
    brand: draft.identity.brand.trim(),
    name: draft.identity.name.trim(),
    barcode: trimOrNull(draft.identity.barcode),
    description: trimOrNull(draft.identity.description),
    benefits: normalizeStringList(draft.identity.benefits),
    suitedFor: normalizeStringList(draft.identity.suitedFor),
    inciIngredients: normalizeStringList(draft.identity.inciIngredients),
    inciLastConfirmedAt: trimOrNull(draft.identity.inciLastConfirmedAt),
  });
  const guidance = normalizeApplicationGuidanceSnapshot({
    ...draft.guidance,
    steps: normalizeStringList(draft.guidance.steps),
    cautions: normalizeStringList(draft.guidance.cautions),
  });
  const manufacturer = normalizeManufacturerInfoSnapshot(
    {
      ...draft.manufacturer,
      brand: trimOrNull(draft.manufacturer.brand) ?? identity.brand,
      parentCompany: trimOrNull(draft.manufacturer.parentCompany),
      countryOfOrigin: trimOrNull(draft.manufacturer.countryOfOrigin),
      countryOfManufacture: trimOrNull(draft.manufacturer.countryOfManufacture),
      supportEmail: trimOrNull(draft.manufacturer.supportEmail),
      productUrl: trimOrNull(draft.manufacturer.productUrl),
      websiteUrl: trimOrNull(draft.manufacturer.websiteUrl),
    },
    identity.brand,
  );
  const userFields = normalizeUserFieldsSnapshot({
    ...draft.userFields,
    openedAt: trimOrNull(draft.userFields.openedAt),
    expiresAt: trimOrNull(draft.userFields.expiresAt),
    pricePaidCurrency: trimOrNull(draft.userFields.pricePaidCurrency),
    purchasedFrom: trimOrNull(draft.userFields.purchasedFrom),
    personalNotes: trimOrNull(draft.userFields.personalNotes),
  });

  return {
    identity,
    guidance,
    manufacturer,
    userFields,
    status: draft.status ?? ShelfStatus.Active,
    provenance: draft.provenance ?? DataProvenance.PhotoLookup,
  };
}
