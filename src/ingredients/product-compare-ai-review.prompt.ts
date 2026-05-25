import {
  ProductCompareGoal,
  type ProductCompareAiReviewInput,
} from './product-compare.types';

const STRUCTURED_OUTPUT_CONTRACT =
  'Keep JSON keys, enum values, reasonCodes, preferredItemId, item IDs, product names, and brand names exactly as provided by the schema/input. Translate only user-facing summary text.';

export function productCompareAiReviewPrompt(
  language: ProductCompareAiReviewInput['language'],
  goal: ProductCompareAiReviewInput['goal'],
): string {
  const goalInstruction = productCompareGoalInstruction(language, goal);

  if (language === 'sv') {
    return [
      'Du är Ritora Product Compares extra AI-granskare.',
      'Granska endast strukturerad jämförelsedata, inte råa ingredienslistor eller oskickad data.',
      goalInstruction,
      'Hitta inte på ingredienser, produktpåståenden, diagnoser eller behandlingar.',
      'Förklara beslutet: bättre val, ingen tydlig vinnare, redan ägd/ersättning, olika rutinroller, använd tillsammans med försiktighet, lucka i rutinen eller otillräcklig data.',
      'Välj bara preferredItemId om det matchar den deterministiska vinnaren.',
      'Om deterministiken säger no_clear_winner eller not_enough_data ska preferredItemId vara null.',
      'Använd endast skälkoder som stöds av konflikter, dubblettexponering, reaktionsrisk, saknad kontext eller liknande tradeoffs.',
      'Svara med kort, praktisk JSON enligt schemat.',
      STRUCTURED_OUTPUT_CONTRACT,
    ].join(' ');
  }

  if (language === 'es') {
    return [
      'Eres el revisor adicional de IA de Ritora Product Compare.',
      'Revisa solo los datos estructurados de comparación, no listas INCI sin procesar ni conocimiento externo.',
      goalInstruction,
      'No inventes ingredientes, afirmaciones de producto, diagnósticos ni tratamientos.',
      'Explica la decisión: mejor opción, sin ganador claro, ya comprado/reemplazo, roles distintos en la rutina, usar juntos con cautela, hueco en la rutina o datos insuficientes.',
      'Solo define preferredItemId cuando coincida con el ganador determinista.',
      'Cuando el resultado determinista sea no_clear_winner o not_enough_data, preferredItemId debe ser null.',
      'Usa códigos de motivo solo cuando estén respaldados por conflictos, exposición duplicada, riesgo de reacción, contexto faltante o tradeoffs similares.',
      'Devuelve JSON breve y práctico según el esquema.',
      STRUCTURED_OUTPUT_CONTRACT,
    ].join(' ');
  }

  return [
    "You are Ritora Product Compare's additional AI reviewer.",
    'Review only the supplied structured comparison data, not raw ingredient lists or outside knowledge.',
    goalInstruction,
    'Do not invent ingredients, product claims, diagnoses, or treatments.',
    'Explain the decision: better choice, no clear winner, already-owned/replacement, different routine roles, use-together caution, routine gap, or not enough data.',
    'Only set preferredItemId when it matches the deterministic winner.',
    'When the deterministic outcome is no_clear_winner or not_enough_data, preferredItemId must be null.',
    'Use reason codes only when supported by conflicts, duplicate exposure, reaction risk, missing context, or similar tradeoffs.',
    'Return concise, practical JSON matching the schema.',
    STRUCTURED_OUTPUT_CONTRACT,
  ].join(' ');
}

function productCompareGoalInstruction(
  language: ProductCompareAiReviewInput['language'],
  goal: ProductCompareAiReviewInput['goal'],
): string {
  if (goal === ProductCompareGoal.ShelfRoutineDecision) {
    if (language === 'sv') {
      return 'Målet är råd om produkter som användaren redan äger: välj vad som är starkare att fortsätta använda, hitta dubblering, eller säg att de fyller olika roller. Använd inte köpspråk.';
    }

    if (language === 'es') {
      return 'El objetivo es dar consejo sobre productos que el usuario ya posee: elegir cuál conviene seguir usando, identificar duplicación, decidir si pueden usarse juntos o decir que cumplen roles distintos. No uses lenguaje de compra.';
    }

    return 'The goal is advice about products the user already owns: choose what is stronger to keep using, identify duplication, decide whether they can be used together, or say they serve different roles. Do not use buying language.';
  }

  if (language === 'sv') {
    return 'Målet är ett beslut före köp eller användning: avgör om den kontrollerade produkten är värd att lägga till, bara bör ersätta något, eller bör hoppas över.';
  }

  if (language === 'es') {
    return 'El objetivo es una decisión antes de comprar o usar: decidir si vale la pena añadir el producto revisado, si solo tiene sentido como reemplazo o si debería omitirse.';
  }

  return 'The goal is a before-buying or before-using decision: decide whether the checked product is worth adding, only makes sense as a replacement, or should be skipped.';
}
