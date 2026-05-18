import { ProductCategory } from '../shelf/shelf.types';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { ProductCheckContextService } from './product-check-context.service';
import {
  ProductCheckContextSignal,
  ProductCheckPersonalizationLevel,
} from './product-check.types';

describe('ProductCheckContextService', () => {
  const journalRepository = {
    find: jest.fn(),
  };
  const suggestionRepository = {
    find: jest.fn(),
  };
  const consentsRepository = {
    find: jest.fn(),
  };
  const dataAccessLogService = {
    recordDataAccess: jest.fn(),
  };
  let service: ProductCheckContextService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductCheckContextService(
      journalRepository as never,
      suggestionRepository as never,
      consentsRepository as never,
      dataAccessLogService as never,
    );
    journalRepository.find.mockResolvedValue([]);
    suggestionRepository.find.mockResolvedValue([]);
    consentsRepository.find.mockResolvedValue([]);
    dataAccessLogService.recordDataAccess.mockResolvedValue(undefined);
  });

  it('returns educational context without consented personal signals', async () => {
    const result = await service.loadForUser({
      userId: 'user-1',
      skinProfile: null,
      activeShelfProducts: [],
    });

    expect(result.context).toEqual(
      expect.objectContaining({
        level: ProductCheckPersonalizationLevel.Educational,
        activeShelfProductCount: 0,
        recentJournalReactionCount: 0,
        recentSuggestionReactionCount: 0,
      }),
    );
    expect(journalRepository.find).not.toHaveBeenCalled();
    expect(suggestionRepository.find).not.toHaveBeenCalled();
    expect(dataAccessLogService.recordDataAccess).not.toHaveBeenCalled();
  });

  it('uses consented journal and suggestion reaction history as context signals', async () => {
    const skinProfile = Object.assign(new SkinProfile(), {
      reaction_history: { entries: [{ trigger: 'niacinamide' }] },
    });
    consentsRepository.find.mockResolvedValue([
      { consent_type: UserConsentType.SkinProgressProcessing },
      { consent_type: UserConsentType.AiSuggestionProcessing },
    ]);
    journalRepository.find.mockResolvedValue([
      { id: 'journal-1', has_reaction_signal: true },
    ]);
    suggestionRepository.find.mockResolvedValue([
      {
        id: 'suggestion-1',
        has_reaction_signal: false,
        simplified_for_reaction: true,
      },
    ]);

    const result = await service.loadForUser({
      userId: 'user-1',
      skinProfile,
      activeShelfProducts: [
        {
          id: 'shelf-1',
          brand: 'Shelf Lab',
          name: 'Barrier Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Niacinamide'],
        },
      ],
    });

    expect(
      result.activeConsentTypes.has(UserConsentType.SkinProgressProcessing),
    ).toBe(true);
    expect(result.context).toEqual(
      expect.objectContaining({
        level: ProductCheckPersonalizationLevel.Personalized,
        recentJournalReactionCount: 1,
        recentSuggestionReactionCount: 1,
        usedSignals: expect.arrayContaining([
          ProductCheckContextSignal.SkinProfile,
          ProductCheckContextSignal.ReactionHistory,
          ProductCheckContextSignal.ActiveShelf,
          ProductCheckContextSignal.SkinJournal,
          ProductCheckContextSignal.SuggestionHistory,
        ]),
      }),
    );
    expect(dataAccessLogService.recordDataAccess).toHaveBeenCalledWith(
      'user-1',
      [UserConsentType.SkinProgressProcessing],
      UserDataAccessPurpose.SkinJournalRead,
    );
    expect(dataAccessLogService.recordDataAccess).toHaveBeenCalledWith(
      'user-1',
      [UserConsentType.AiSuggestionProcessing],
      UserDataAccessPurpose.RecommendationAnalysis,
    );
  });
});
