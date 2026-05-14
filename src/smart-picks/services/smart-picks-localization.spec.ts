import { SUPPORTED_LANGUAGES } from '../../common/i18n/i18n';
import {
  localizeSmartPicksCoveredItems,
  localizeSmartPicksGapText,
  localizeSmartPicksRedundancyGroups,
  SMART_PICKS_ACTIVE_TAGS,
  SMART_PICKS_COVERAGE_ROLES,
  smartPicksActiveTagLabel,
  smartPicksCoverageRoleLabel,
} from './smart-picks-localization';

describe('Smart Picks localization', () => {
  it.each(SUPPORTED_LANGUAGES)(
    'has coverage role and active tag labels for %s',
    (language) => {
      for (const role of SMART_PICKS_COVERAGE_ROLES) {
        expect(smartPicksCoverageRoleLabel(role, language)).toEqual(
          expect.stringMatching(/\S/),
        );
      }

      for (const activeTag of SMART_PICKS_ACTIVE_TAGS) {
        expect(smartPicksActiveTagLabel(activeTag, language)).toEqual(
          expect.stringMatching(/\S/),
        );
      }
    },
  );

  it('localizes covered role reasons from stable backend role codes', () => {
    expect(
      localizeSmartPicksCoveredItems(
        [
          {
            role: 'texture-exfoliant',
            productName: 'Gentle Exfoliant',
            reason: 'Legacy English reason.',
          },
        ],
        'sv',
      ),
    ).toEqual([
      {
        role: 'texture-exfoliant',
        productName: 'Gentle Exfoliant',
        reason: 'Täcker rollen texturpeeling.',
      },
    ]);
  });

  it('localizes deterministic gap titles, reasons, and alignment labels from stable gap keys', () => {
    expect(
      localizeSmartPicksGapText(
        {
          normalizedKey: 'adapalene-or-benzoyl-peroxide-acne-treatment',
          ingredientOrCategory: 'Adapalene or benzoyl peroxide acne treatment',
          reason:
            'Your goal points to breakouts, and the shelf does not yet show a clear leave-on breakout treatment lane.',
          shortReason:
            'Your goal points to breakouts, and the shelf does not yet show a clear leave-on breakout treatment lane.',
          goalAlignment: 'breakout control',
        },
        'sv',
      ),
    ).toEqual({
      normalizedKey: 'adapalene-or-benzoyl-peroxide-acne-treatment',
      ingredientOrCategory: 'Aknebehandling med adapalen eller bensoylperoxid',
      reason:
        'Ditt mål pekar på finnar och utbrott, och hyllan visar ännu ingen tydlig behandling som lämnas kvar på huden.',
      shortReason:
        'Ditt mål pekar på finnar och utbrott, och hyllan visar ännu ingen tydlig behandling som lämnas kvar på huden.',
      goalAlignment: 'utbrottskontroll',
    });
  });

  it('localizes redundancy hints from stable backend active tag codes', () => {
    expect(smartPicksActiveTagLabel('barrier-support', 'sv')).toBe(
      'barriärstöd',
    );

    expect(
      localizeSmartPicksRedundancyGroups(
        [
          {
            activeTag: 'vitamin_c',
            hint: 'Legacy English hint.',
            products: [
              {
                id: 'one',
                brand: 'Brand',
                name: 'Vitamin C Serum',
                recommendation: 'keep',
              },
              {
                id: 'two',
                brand: 'Brand',
                name: 'Brightening Serum',
                recommendation: 'finish-first',
              },
            ],
          },
        ],
        'sv',
      ),
    ).toEqual([
      expect.objectContaining({
        activeTag: 'vitamin_c',
        hint: 'Du har 2 produkter med signaler för vitamin C. Använd upp en innan du lägger till en till.',
      }),
    ]);
  });
});
