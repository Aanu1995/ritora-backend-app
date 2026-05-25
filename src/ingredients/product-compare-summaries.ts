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

  if (language === 'es') {
    if (outcome === ProductCompareOutcome.ChooseAnchor) {
      return `${winnerName ?? 'El producto nuevo'} parece la mejor opción para tu piel y rutina.`;
    }

    if (outcome === ProductCompareOutcome.ChooseCandidate) {
      return `${winnerName ?? 'El producto de tu estante'} parece la mejor opción para tu piel y rutina.`;
    }

    if (outcome === ProductCompareOutcome.NotEnoughData) {
      return 'No hay suficientes datos fiables de ingredientes para elegir un ganador.';
    }

    return 'Estos productos tienen ventajas y desventajas parecidas, así que Ritora no puede elegir un ganador claro.';
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

    if (language === 'es') {
      return 'Estos productos de tu estante se solapan mucho. Conserva ambos solo si cumplen momentos claramente distintos en tu rutina.';
    }

    return 'These shelf products overlap heavily. Keep both only if they serve clearly different moments in your routine.';
  }

  if (language === 'sv') {
    return 'Det här liknar en produkt du redan äger. Köp den bara om du ersätter produkten på hyllan.';
  }

  if (language === 'es') {
    return 'Esto se parece mucho a un producto que ya tienes. Solo vale la pena comprarlo si vas a reemplazar el producto de tu estante.';
  }

  return 'This looks very similar to a product you already own. It is only worth buying if you are replacing the shelf product.';
}

export function productCompareSummaryForDifferentShelfRoles(
  language: AppLanguage,
): string {
  if (language === 'sv') {
    return 'Produkterna fyller olika roller i rutinen. De behöver inte tävla, men Ritora ser inga tydliga användningskonflikter mellan dem.';
  }

  if (language === 'es') {
    return 'Estos productos cumplen roles distintos en la rutina. No necesitan competir, y Ritora no ve un conflicto claro al usarlos juntos.';
  }

  return 'These products serve different routine roles. They do not need to compete, and Ritora does not see a clear use-together conflict between them.';
}

export function productCompareSummaryForNewProductGap(
  language: AppLanguage,
): string {
  if (language === 'sv') {
    return 'Den kontrollerade produkten fyller en annan roll än produkterna du valde och ser rimlig ut att överväga som ett tillägg.';
  }

  if (language === 'es') {
    return 'El producto revisado cumple un rol distinto al de los productos de tu estante que seleccionaste y parece razonable considerarlo como añadido.';
  }

  return 'The checked product fills a different role from the Shelf products you selected and looks reasonable to consider as an addition.';
}

export function productCompareSummaryForNewProductRoutineConflict(
  language: AppLanguage,
): string {
  if (language === 'sv') {
    return 'Den kontrollerade produkten fyller en annan roll, men den kan krocka med något på hyllan. Lägg inte till den utan en tydlig plan för när den ska användas.';
  }

  if (language === 'es') {
    return 'El producto revisado cumple un rol distinto, pero podría chocar con algo de tu estante. No lo añadas sin un plan claro de cuándo usarlo.';
  }

  return 'The checked product serves a different role, but it may clash with something on your Shelf. Do not add it without a clear plan for when to use it.';
}

export function productCompareSummaryForShelfRoutineConflict(
  language: AppLanguage,
): string {
  if (language === 'sv') {
    return 'Produkterna fyller olika roller, men de har en möjlig användningskonflikt. Använd dem inte tillsammans utan att separera dem i rutinen.';
  }

  if (language === 'es') {
    return 'Estos productos cumplen roles distintos, pero tienen un posible conflicto de uso conjunto. No los superpongas sin separarlos dentro de tu rutina.';
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

  if (language === 'es') {
    if (outcome === ProductCompareOutcome.ChooseAnchor) {
      return `${winnerName ?? 'Este producto de tu estante'} parece la opción más fuerte para seguir usando.`;
    }

    if (outcome === ProductCompareOutcome.ChooseCandidate) {
      return `${winnerName ?? 'El otro producto de tu estante'} parece la opción más fuerte para seguir usando.`;
    }

    if (outcome === ProductCompareOutcome.NotEnoughData) {
      return 'No hay suficientes datos fiables de ingredientes para aconsejar sobre estos productos de tu estante.';
    }

    return 'Estos productos de tu estante tienen ventajas y desventajas parecidas, así que Ritora no forzará un ganador.';
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
