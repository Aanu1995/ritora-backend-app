import {
  getSuggestionEvidenceSources,
  mergeEvidenceSourceIds,
  sourceIdsForActiveTags,
} from './suggestion-evidence-sources';
import { SuggestionEvidenceSourceId } from '../suggestions.constants';

describe('suggestion evidence sources', () => {
  it('returns stable trusted-source metadata for cited product decisions', () => {
    const sources = getSuggestionEvidenceSources([
      SuggestionEvidenceSourceId.AadSunscreenSelection,
      SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      SuggestionEvidenceSourceId.AadSunscreenSelection,
    ]);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual(
      expect.objectContaining({
        id: SuggestionEvidenceSourceId.AadSunscreenSelection,
        organization: 'American Academy of Dermatology',
        evidenceType: 'dermatology_association',
        url: expect.stringContaining('aad.org'),
      }),
    );
    expect(sources[1]).toEqual(
      expect.objectContaining({
        id: SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
        organization: 'U.S. Food and Drug Administration',
        evidenceType: 'regulatory_guidance',
        url: expect.stringContaining('fda.gov'),
      }),
    );
  });

  it('maps ingredient active tags to conservative trusted-source ids', () => {
    expect(sourceIdsForActiveTags(['retinoid', 'aha'])).toEqual(
      expect.arrayContaining([
        SuggestionEvidenceSourceId.AadRetinoidRetinol,
        SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ]),
    );
    expect(sourceIdsForActiveTags(['spf'])).toEqual([
      SuggestionEvidenceSourceId.AadSunscreenSelection,
    ]);
  });

  it('deduplicates source ids while preserving first-use order', () => {
    expect(
      mergeEvidenceSourceIds(
        [SuggestionEvidenceSourceId.AadAcneTreatment],
        [
          SuggestionEvidenceSourceId.AadAcneTreatment,
          SuggestionEvidenceSourceId.MayoDrySkinCare,
        ],
      ),
    ).toEqual([
      SuggestionEvidenceSourceId.AadAcneTreatment,
      SuggestionEvidenceSourceId.MayoDrySkinCare,
    ]);
  });
});
