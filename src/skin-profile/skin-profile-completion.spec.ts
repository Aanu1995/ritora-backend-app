import type { SkinProfile } from './entities/skin-profile.entity';
import {
  hasCompletedEssentialSkinProfile,
  skinProfileRequiredException,
} from './skin-profile-completion';

function completeProfile(overrides: Partial<SkinProfile> = {}): SkinProfile {
  return {
    user: {
      date_of_birth: '1992-04-15',
      sex_at_birth: 'female',
    },
    skin_type: 'oily',
    skin_tone: 'medium',
    fitzpatrick_phototype: 'IV',
    ethnicity: 'black',
    current_concerns: ['acne'],
    primary_goal: 'clear_acne',
    concern_details: {
      per_concern: [{ concern: 'acne', severity: 'moderate' }],
    },
    skin_behavior: {
      pih_tendency: 'often',
      melasma_tendency: 'never',
      keloid_tendency: 'never',
      sunscreen_habit: 'most_days',
      sunscreen_tolerance: 'fine',
    },
    routine_preferences: {
      pace: 'cautious',
      fragrance_free: true,
      non_comedogenic: true,
      sunscreen_filter: 'hybrid',
      sunscreen_finish: 'natural',
    },
    budget_tier: 'mid',
    allow_smart_picks: true,
    ...overrides,
  } as SkinProfile;
}

describe('skin profile completion helpers', () => {
  it('accepts a completed essential profile', () => {
    expect(hasCompletedEssentialSkinProfile(completeProfile())).toBe(true);
  });

  it('rejects missing profile and incomplete essential fields', () => {
    expect(hasCompletedEssentialSkinProfile(null)).toBe(false);
    expect(
      hasCompletedEssentialSkinProfile(completeProfile({ primary_goal: null })),
    ).toBe(false);
  });

  it('rejects profiles without severity for every selected concern', () => {
    expect(
      hasCompletedEssentialSkinProfile(
        completeProfile({
          current_concerns: ['acne', 'redness'],
          concern_details: {
            per_concern: [{ concern: 'acne', severity: 'moderate' }],
          },
        }),
      ),
    ).toBe(false);
  });

  it('uses a stable error code for prerequisite failures', () => {
    expect(skinProfileRequiredException().getResponse()).toMatchObject({
      code: 'skin_profile_required',
    });
  });
});
