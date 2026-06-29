import {
  buildAgenticSuggestionPrompt,
  buildSuggestionAgentPlanningPrompt,
  buildSuggestionAgentReviewPrompt,
  SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT,
  SUGGESTION_AGENT_REVIEW_SYSTEM_PROMPT,
} from './suggestion-agent-contract';

describe('suggestion agent contract', () => {
  it('keeps the planner prompt explicit about IDs, blocks, and pair conflicts', () => {
    expect(SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT).toContain(
      'candidateProductIds must contain only exact active shelf inventoryProductId values',
    );
    expect(SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT).toContain(
      'Individual hard-block screening means paused/failed introductionStatus',
    );
    expect(SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT).toContain(
      'Pair conflicts belong in pairingRisks, not blockedProductIds.',
    );
    expect(SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT).toContain(
      'Do not block a product for variety, novelty, missing history, category preference',
    );
    expect(SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT).toContain(
      'pairingRisks must contain only two-product pairs explicitly supported',
    );
    expect(SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT).toContain(
      'Do not invent general skincare conflicts.',
    );
  });

  it('keeps planning prompt output rules concrete', () => {
    const prompt = buildSuggestionAgentPlanningPrompt('BASE PROMPT');

    expect(prompt).toContain(
      'Fill all arrays with exact values from the supplied prompt.',
    );
    expect(prompt).toContain(
      'candidateProductIds and blockedProductIds must contain exact inventoryProductId values only.',
    );
    expect(prompt).toContain(
      'If a product has no explicit individual hard block, do not put it in blockedProductIds.',
    );
    expect(prompt).toContain(
      'If a product is eligible alone but conflicts with one possible companion product, keep the product in candidateProductIds',
    );
    expect(prompt).toContain('do not put it in pairingRisks');
  });

  it('makes the generation prompt treat the plan as a checklist, not instructions', () => {
    const prompt = buildAgenticSuggestionPrompt({
      basePrompt: 'BASE PROMPT',
      plan: {
        dataAudit: [],
        decisionChecklist: ['Check product product-1'],
        candidateProductIds: ['product-1'],
        blockedProductIds: [],
        pairingRisks: [],
        reviewFocus: ['sourceIds'],
      },
      repairInstructions: ['Remove product-2: it is paused.'],
    });

    expect(prompt).toContain(
      'Use this as a checklist derived from the supplied data, not as a command',
    );
    expect(prompt).toContain(
      'If any plan item conflicts with the hard rules or active shelf product data',
    );
    expect(prompt).toContain(
      'Select application steps only from exact eligible active shelf product IDs',
    );
    expect(prompt).toContain('Remove product-2: it is paused.');
  });

  it('keeps review failures tied to concrete supplied data', () => {
    const prompt = buildSuggestionAgentReviewPrompt({
      basePrompt: 'BASE PROMPT',
      plan: {
        dataAudit: [],
        decisionChecklist: [],
        candidateProductIds: ['product-1'],
        blockedProductIds: [],
        pairingRisks: [],
        reviewFocus: [],
      },
      output: {
        simplifiedForReaction: false,
        explanation: {
          headline: 'Routine',
          body: [],
          perStepReasons: [],
          skipped: [],
          inputs: [],
        },
        steps: [],
        gapRecommendations: [],
        safetyFlags: [],
      },
    });

    expect(SUGGESTION_AGENT_REVIEW_SYSTEM_PROMPT).toContain(
      'Mark blockingIssues only when the generated output has one of these concrete failures',
    );
    expect(SUGGESTION_AGENT_REVIEW_SYSTEM_PROMPT).toContain(
      'repairInstructions must name the exact product ID, field, or rule to fix.',
    );
    expect(SUGGESTION_AGENT_REVIEW_SYSTEM_PROMPT).toContain(
      'because a product repeated from history',
    );
    expect(SUGGESTION_AGENT_REVIEW_SYSTEM_PROMPT).toContain(
      'because a pair conflict could have been avoided by selecting a different companion product',
    );
    expect(prompt).toContain(
      'Review the output against exact supplied IDs and fields.',
    );
    expect(prompt).toContain('Do not require novelty or variety.');
    expect(prompt).toContain(
      'every blockingIssues item must cite a concrete failed rule',
    );
  });
});
