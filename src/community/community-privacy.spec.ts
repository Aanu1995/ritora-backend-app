import { buildCommunitySafeFacets } from './community-privacy';
import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';

describe('community privacy shaping', () => {
  it('only exposes safe matching facets from a sensitive skin profile', () => {
    const profile = {
      skin_type: 'sensitive',
      skin_tone: 'iv',
      ethnicity: 'private-ethnicity',
      current_concerns: ['Dark marks', 'Dryness'],
      safety_context: {
        medications: ['private-medication'],
        conditions: ['private-condition'],
      },
      reaction_history: {
        entries: [{ trigger: 'private-trigger' }],
      },
      lifestyle_context: {
        climate_sensitivities: ['Cold weather'],
        water_reaction_notes: 'private note',
      },
      routine_preferences: {
        pace: 'cautious',
      },
      concern_details: {
        per_concern: [{ concern: 'Hyperpigmentation' }],
      },
    } as SkinProfile;

    const facets = buildCommunitySafeFacets(profile);
    const serialized = JSON.stringify(facets);

    expect(facets).toEqual({
      skinType: 'sensitive',
      concernTags: ['dark-marks', 'dryness'],
      sensitivityLevel: 'sensitive',
      skinToneRange: 'iv',
      climateBucket: 'cold-weather',
      routinePace: 'cautious',
      goalTags: ['hyperpigmentation'],
    });
    expect(serialized).not.toContain('private-ethnicity');
    expect(serialized).not.toContain('private-medication');
    expect(serialized).not.toContain('private-condition');
    expect(serialized).not.toContain('private-trigger');
    expect(serialized).not.toContain('private note');
  });
});
