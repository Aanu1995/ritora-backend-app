export const SKIN_TYPES = [
  'oily',
  'dry',
  'combination',
  'normal',
  'sensitive',
] as const;

export const SKIN_TONES = [
  'very_light',
  'light',
  'light_medium',
  'medium',
  'medium_dark',
  'dark',
  'very_dark',
] as const;

export const ETHNICITIES = [
  'black',
  'white_caucasian',
  'asian',
  'hispanic_latino',
  'middle_eastern',
  'mixed',
  'other',
] as const;

export const SKIN_CONCERNS = [
  'acne',
  'dark_marks',
  'dryness',
  'oiliness',
  'texture',
  'redness',
  'large_pores',
  'fine_lines',
  'barrier_damage',
  'eczema',
  'uneven_tone',
] as const;

export const FITZPATRICK_PHOTOTYPES = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
] as const;

export const SENSITIVITY_LEVELS = [
  'low',
  'moderate',
  'high',
  'very_high',
] as const;

export const HYDRATION_LEVELS = [
  'well_hydrated',
  'dehydrated',
  'very_dehydrated',
] as const;

export const PREGNANCY_STATUSES = [
  'not_pregnant',
  'trying_to_conceive',
  'pregnant',
  'breastfeeding',
  'prefer_not_to_say',
] as const;

export const SEX_AT_BIRTH = [
  'female',
  'male',
  'intersex',
  'prefer_not_to_say',
] as const;

export const SKIN_CONDITIONS = [
  'rosacea',
  'eczema',
  'psoriasis',
  'perioral_dermatitis',
  'seborrheic_dermatitis',
  'melasma',
  'vitiligo',
  'keratosis_pilaris',
  'other',
] as const;

export const SKIN_MEDICATIONS = [
  'isotretinoin',
  'topical_retinoid',
  'topical_antibiotic',
  'oral_antibiotic',
  'hormonal_contraceptive',
  'hrt',
  'topical_corticosteroid',
  'other_photosensitizing',
] as const;

export const PROCEDURE_TYPES = [
  'chemical_peel',
  'laser',
  'microneedling',
  'microdermabrasion',
  'botox',
  'filler',
] as const;

export const SUNSCREEN_HABITS = [
  'rarely',
  'when_outside',
  'most_days',
  'every_day',
] as const;

export const SUNSCREEN_TOLERANCES = [
  'fine',
  'a_bit_irritating',
  'often_irritating',
  'havent_tried_many',
] as const;

export const SUNSCREEN_FILTERS = ['chemical', 'mineral', 'hybrid'] as const;

export const SUNSCREEN_FINISHES = [
  'matte',
  'dewy',
  'tinted',
  'natural',
] as const;

export const TENDENCY_LEVELS = [
  'never',
  'sometimes',
  'often',
  'always',
] as const;

export const ACTIVE_INGREDIENT_KEYS = [
  'retinoids',
  'aha',
  'bha',
  'pha',
  'benzoyl_peroxide',
  'vitamin_c',
  'niacinamide',
  'azelaic_acid',
  'exfoliation',
] as const;

export const ACTIVE_TOLERANCE_LEVELS = [
  'never_tried',
  'tolerates_well',
  'sensitive_to_it',
  'cannot_use',
] as const;

export const ROUTINE_PACES = ['cautious', 'moderate', 'aggressive'] as const;

export const BUDGET_TIERS = ['drugstore', 'mid', 'premium', 'luxury'] as const;

export const TEXTURE_PREFERENCES = [
  'lightweight',
  'rich',
  'gel',
  'cream',
  'oil_free',
] as const;

export const INGREDIENT_ETHICS = [
  'vegan',
  'cruelty_free',
  'fragrance_free',
  'clean',
] as const;

export const REACTION_TRIGGER_TYPES = [
  'ingredient',
  'product',
  'category',
  'fragrance',
  'preservative',
] as const;

export const REACTION_TYPES = [
  'redness',
  'itch',
  'stinging',
  'dryness',
  'breakout',
  'hives',
  'swelling',
] as const;

export const REACTION_SEVERITIES = ['mild', 'moderate', 'severe'] as const;

export const REACTION_CERTAINTIES = [
  'suspected',
  'confirmed_repeat',
  'confirmed_patch_test',
] as const;

export const STRESS_LEVELS = ['low', 'moderate', 'high'] as const;

export const SLEEP_LEVELS = ['under_6', '6_to_8', 'over_8'] as const;

export const WATER_INTAKE_LEVELS = ['low', 'moderate', 'high'] as const;

export const DIET_FLAGS = [
  'high_sugar',
  'high_dairy',
  'low_sugar',
  'low_dairy',
  'vegan',
  'vegetarian',
] as const;

export const SMOKING_LEVELS = ['none', 'occasional', 'regular'] as const;

export const ALCOHOL_LEVELS = ['none', 'occasional', 'regular'] as const;

export const CLIMATE_SENSITIVITIES = [
  'dry_air',
  'humidity',
  'cold',
  'pollution',
  'heat',
] as const;

export const CYCLE_PATTERNS = [
  'regular',
  'irregular',
  'not_applicable',
  'not_sure',
] as const;

export const HORMONAL_BREAKOUT_PATTERNS = [
  'before_period',
  'during_period',
  'ovulation',
  'random',
  'not_sure',
] as const;

export const HEALTH_CONTEXT_FIELD_KEYS = [
  'pregnancy_status',
  'under_dermatologist_care',
  'safety_context',
] as const;

export const HORMONAL_CONTEXT_FIELD_KEYS = ['hormonal_context'] as const;

export const SKIN_PROFILE_ERROR_CODES = {
  HealthConsentRequired: 'HEALTH_CONTEXT_CONSENT_REQUIRED',
  HormonalConsentRequired: 'HORMONAL_CONTEXT_CONSENT_REQUIRED',
  HormonalContextNotApplicable: 'HORMONAL_CONTEXT_NOT_APPLICABLE',
  InvalidActiveTolerances: 'INVALID_ACTIVE_TOLERANCES',
  EssentialsRequired: 'SKIN_PROFILE_ESSENTIALS_REQUIRED',
} as const;
