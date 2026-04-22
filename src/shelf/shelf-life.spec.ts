import {
  DataProvenance,
  ProductCategory,
  ShelfStatus,
  type ShelfProductSnapshot,
} from './shelf.types';
import { deriveShelfLife, ShelfLifeState } from './shelf-life';

function createSnapshot(): ShelfProductSnapshot {
  return {
    identity: {
      brand: 'CeraVe',
      name: 'SA Cleanser',
      category: ProductCategory.Cleanser,
      barcode: null,
      imageUrls: [],
      sizeMl: 236,
      description: null,
      benefits: [],
      suitedFor: [],
      inciIngredients: [],
      inciLastConfirmedAt: null,
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    manufacturer: {
      brand: 'CeraVe',
      parentCompany: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      supportEmail: null,
      productUrl: null,
      websiteUrl: null,
    },
    userFields: {
      openedAt: '2026-04-01T00:00:00.000Z',
      expiresAt: '2026-04-02T00:00:00.000Z',
      periodAfterOpeningMonths: null,
      pricePaid: null,
      pricePaidCurrency: null,
      purchasedFrom: null,
      personalNotes: null,
      preferredTimeOfDay: null,
    },
    status: ShelfStatus.Active,
    provenance: DataProvenance.UserEntered,
  };
}

describe('shelf-life', () => {
  it('evaluates calendar dates in the effective timezone instead of raw UTC instants', () => {
    const snapshot = createSnapshot();

    expect(
      deriveShelfLife(snapshot, {
        timeZone: 'America/New_York',
        now: new Date('2026-04-02T03:00:00.000Z'),
      }),
    ).toEqual({
      state: ShelfLifeState.Fresh,
      remainingFraction: 1,
      remainingDays: 1,
    });
  });
});
