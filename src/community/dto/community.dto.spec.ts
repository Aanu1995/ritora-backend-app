import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CommunityDisclosureType,
  CommunityGoalResult,
  CommunityGoalTimeframe,
  CommunityOutcomeFollowedPart,
  CommunityOutcomeIrritationLevel,
  CommunityOutcomeSignal,
  CommunityOutcomeTrialDuration,
  CommunityReviewRoutineSlot,
  CommunityReviewSkinResponse,
} from '../community.types';
import {
  CommunityOutcomeSignalDto,
  CreateCommunityReviewDto,
  CreateCommunityRoutineDto,
} from './community.dto';

const validationOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

const validReviewPayload = {
  productBrand: 'Ritora',
  productName: 'Barrier Cream',
  productCategory: 'moisturizer',
  disclosureType: CommunityDisclosureType.Ordinary,
  usageDuration: '8-weeks',
  frequency: 'daily',
  routineSlot: CommunityReviewRoutineSlot.PM,
  skinResponse: CommunityReviewSkinResponse.Improved,
  outcomes: ['barrier-support', 'less-stinging'],
  repurchase: 'yes',
  overallRating: 5,
  effectivenessRating: 4,
  irritationRating: 1,
  textureRating: 4,
  valueRating: 3,
  routineContext: [
    {
      category: 'cleanser',
      productBrand: 'Ritora',
      productName: 'Milky Cleanser',
    },
  ],
  body: 'Worked best when I kept the rest of the routine simple.',
};

describe('CreateCommunityReviewDto', () => {
  it('accepts structured review evidence required for useful matching', async () => {
    const dto = plainToInstance(CreateCommunityReviewDto, validReviewPayload);

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
  });

  it('rejects reviews without ratings and routine timing context', async () => {
    const dto = plainToInstance(CreateCommunityReviewDto, {
      ...validReviewPayload,
      overallRating: undefined,
      effectivenessRating: undefined,
      irritationRating: undefined,
      routineSlot: undefined,
      skinResponse: undefined,
    });

    const errors = await validate(dto, validationOptions);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'overallRating',
        'effectivenessRating',
        'irritationRating',
        'routineSlot',
        'skinResponse',
      ]),
    );
  });

  it('keeps ratings inside the public five-point evidence scale', async () => {
    const dto = plainToInstance(CreateCommunityReviewDto, {
      ...validReviewPayload,
      overallRating: 6,
      effectivenessRating: 0,
      irritationRating: 8,
    });

    const errors = await validate(dto, validationOptions);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'overallRating',
        'effectivenessRating',
        'irritationRating',
      ]),
    );
  });

  it('accepts named products used alongside the reviewed product', async () => {
    const dto = plainToInstance(CreateCommunityReviewDto, {
      ...validReviewPayload,
      routineContext: [
        {
          category: 'cleanser',
          productBrand: 'Ritora',
          productName: 'Milky Cleanser',
        },
        {
          category: 'sunscreen',
          productName: 'Mineral SPF 50',
        },
      ],
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
  });
});

const validGoalPlaybookPayload = {
  title: 'What helped calm my acne breakouts',
  summary:
    'I got the best result when I simplified actives and stopped late-night sugar-heavy snacks.',
  disclosureType: CommunityDisclosureType.Ordinary,
  concernTags: ['acne'],
  goalTags: ['acne-control'],
  goalResult: CommunityGoalResult.MostlyImproved,
  timeframe: CommunityGoalTimeframe.SixMonths,
  avoidTags: ['over-exfoliation', 'late-night-sugary-food'],
  habitTags: ['consistent-sleep', 'changed-pillowcase'],
  didNotWorkTags: ['daily-acids'],
  warningTags: ['go-slow-if-sensitive'],
  steps: [
    {
      slot: 'pm',
      productId: 'product_1',
      category: 'cleanser',
      productBrand: 'Ritora',
      productName: 'Milky Cleanser',
      frequency: 'daily',
    },
    {
      slot: 'pm',
      productId: 'product_2',
      category: 'moisturizer',
      productBrand: 'Ritora',
      productName: 'Barrier Cream',
      frequency: 'daily',
    },
  ],
};

describe('CreateCommunityRoutineDto goal playbooks', () => {
  it('accepts structured products, routines and avoid selections for a goal', async () => {
    const dto = plainToInstance(
      CreateCommunityRoutineDto,
      validGoalPlaybookPayload,
    );

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
  });

  it('allows optional what-changed evidence while requiring timeframe and steps', async () => {
    const dto = plainToInstance(CreateCommunityRoutineDto, {
      ...validGoalPlaybookPayload,
      goalResult: undefined,
      timeframe: undefined,
      avoidTags: [],
      steps: [],
    });

    const errors = await validate(dto, validationOptions);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['timeframe', 'steps']),
    );
    expect(errors.map((error) => error.property)).not.toEqual(
      expect.arrayContaining(['goalResult', 'avoidTags']),
    );
  });
});

describe('CommunityOutcomeSignalDto', () => {
  it('requires contextual confirmation before adding outcome evidence', async () => {
    const dto = plainToInstance(CommunityOutcomeSignalDto, {
      signal: CommunityOutcomeSignal.WorkedForMeToo,
      sameGoal: true,
      trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
      followedParts: [
        CommunityOutcomeFollowedPart.Products,
        CommunityOutcomeFollowedPart.AvoidList,
      ],
      irritationLevel: CommunityOutcomeIrritationLevel.None,
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
  });

  it('rejects outcome signals without trial context', async () => {
    const dto = plainToInstance(CommunityOutcomeSignalDto, {
      signal: CommunityOutcomeSignal.MixedResult,
      followedParts: [],
    });

    const errors = await validate(dto, validationOptions);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'sameGoal',
        'trialDuration',
        'followedParts',
        'irritationLevel',
      ]),
    );
  });
});
