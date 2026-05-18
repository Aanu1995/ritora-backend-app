import type { AppLanguage } from '../common/i18n/i18n';
import {
  ProductCompareGoal,
  ProductCompareOutcome,
} from './product-compare.types';

export function productCompareSummaryForOutcome(
  goal: ProductCompareGoal,
  outcome: ProductCompareOutcome,
  winnerName: string | null,
  language: AppLanguage,
): string {
  if (goal === ProductCompareGoal.ShelfRoutineDecision) {
    return productCompareSummaryForShelfOutcome(outcome, winnerName, language);
  }

  if (language === 'sv') {
    if (outcome === ProductCompareOutcome.ChooseAnchor) {
      return `${winnerName ?? 'Den nya produkten'} ser ut som det bättre valet för din hud och rutin.`;
    }

    if (outcome === ProductCompareOutcome.ChooseCandidate) {
      return `${winnerName ?? 'Hyllprodukten'} ser ut som det bättre valet för din hud och rutin.`;
    }

    if (outcome === ProductCompareOutcome.NotEnoughData) {
      return 'Det finns inte tillräckligt med tillförlitlig ingrediensdata för att välja en vinnare.';
    }

    return 'Produkterna har liknande tradeoffs, så Ritora kan inte välja en tydlig vinnare.';
  }

  if (outcome === ProductCompareOutcome.ChooseAnchor) {
    return `${winnerName ?? 'The new product'} looks like the better fit for your skin and routine.`;
  }

  if (outcome === ProductCompareOutcome.ChooseCandidate) {
    return `${winnerName ?? 'The shelf product'} looks like the better fit for your skin and routine.`;
  }

  if (outcome === ProductCompareOutcome.NotEnoughData) {
    return 'There is not enough reliable ingredient data to choose a winner.';
  }

  return 'These products have similar tradeoffs, so Ritora cannot choose a clear winner.';
}

export function productCompareSummaryForDuplicate(
  goal: ProductCompareGoal,
  language: AppLanguage,
): string {
  if (goal === ProductCompareGoal.ShelfRoutineDecision) {
    if (language === 'sv') {
      return 'De här hyllprodukterna överlappar mycket. Behåll båda bara om de fyller tydligt olika stunder i rutinen.';
    }

    return 'These shelf products overlap heavily. Keep both only if they serve clearly different moments in your routine.';
  }

  if (language === 'sv') {
    return 'Det här liknar en produkt du redan äger. Köp den bara om du ersätter produkten på hyllan.';
  }

  return 'This looks very similar to a product you already own. It is only worth buying if you are replacing the shelf product.';
}

export function productCompareSummaryForDifferentShelfRoles(
  language: AppLanguage,
): string {
  if (language === 'sv') {
    return 'Produkterna fyller olika roller i rutinen. De behöver inte tävla, men Ritora ser inga tydliga användningskonflikter mellan dem.';
  }

  return 'These products serve different routine roles. They do not need to compete, and Ritora does not see a clear use-together conflict between them.';
}

export function productCompareSummaryForNewProductGap(
  language: AppLanguage,
): string {
  if (language === 'sv') {
    return 'Den kontrollerade produkten fyller en annan roll än produkterna du valde och ser rimlig ut att överväga som ett tillägg.';
  }

  return 'The checked product fills a different role from the Shelf products you selected and looks reasonable to consider as an addition.';
}

export function productCompareSummaryForNewProductRoutineConflict(
  language: AppLanguage,
): string {
  if (language === 'sv') {
    return 'Den kontrollerade produkten fyller en annan roll, men den kan krocka med något på hyllan. Lägg inte till den utan en tydlig plan för när den ska användas.';
  }

  return 'The checked product serves a different role, but it may clash with something on your Shelf. Do not add it without a clear plan for when to use it.';
}

export function productCompareSummaryForShelfRoutineConflict(
  language: AppLanguage,
): string {
  if (language === 'sv') {
    return 'Produkterna fyller olika roller, men de har en möjlig användningskonflikt. Använd dem inte tillsammans utan att separera dem i rutinen.';
  }

  return 'These products serve different roles, but they have a possible use-together conflict. Do not layer them together without separating them in your routine.';
}

function productCompareSummaryForShelfOutcome(
  outcome: ProductCompareOutcome,
  winnerName: string | null,
  language: AppLanguage,
): string {
  if (language === 'sv') {
    if (outcome === ProductCompareOutcome.ChooseAnchor) {
      return `${winnerName ?? 'Hyllprodukten'} ser ut som det starkare valet att fortsätta använda.`;
    }

    if (outcome === ProductCompareOutcome.ChooseCandidate) {
      return `${winnerName ?? 'Den andra hyllprodukten'} ser ut som det starkare valet att fortsätta använda.`;
    }

    if (outcome === ProductCompareOutcome.NotEnoughData) {
      return 'Det finns inte tillräckligt med tillförlitlig ingrediensdata för att ge råd om de här hyllprodukterna.';
    }

    return 'Hyllprodukterna har liknande tradeoffs, så Ritora väljer ingen vinnare i onödan.';
  }

  if (outcome === ProductCompareOutcome.ChooseAnchor) {
    return `${winnerName ?? 'This shelf product'} looks like the stronger option to keep using.`;
  }

  if (outcome === ProductCompareOutcome.ChooseCandidate) {
    return `${winnerName ?? 'The other shelf product'} looks like the stronger option to keep using.`;
  }

  if (outcome === ProductCompareOutcome.NotEnoughData) {
    return 'There is not enough reliable ingredient data to advise on these shelf products.';
  }

  return 'These shelf products have similar tradeoffs, so Ritora will not force a winner.';
}
