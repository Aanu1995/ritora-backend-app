import type { AppLanguage } from '../common/i18n/i18n';
import { ProductCategory } from '../shelf/shelf.types';
import type {
  LayeringStep,
  ProductForAnalysis,
  ProductMatchResult,
} from './ingredients.types';

const CATEGORY_WEIGHT: Record<ProductCategory, number> = {
  [ProductCategory.Cleanser]: 10,
  [ProductCategory.Toner]: 20,
  [ProductCategory.Essence]: 30,
  [ProductCategory.Exfoliant]: 35,
  [ProductCategory.Serum]: 40,
  [ProductCategory.Treatment]: 45,
  [ProductCategory.Moisturizer]: 60,
  [ProductCategory.EyeCare]: 65,
  [ProductCategory.LipCare]: 70,
  [ProductCategory.SunProtection]: 80,
  [ProductCategory.Mask]: 90,
  [ProductCategory.Other]: 100,
};

function getProductPhMin(match: ProductMatchResult | undefined): number | null {
  if (!match) {
    return null;
  }

  const values = match.matchedIngredients
    .map(({ ingredient }) => ingredient.phMin)
    .filter((value): value is number => typeof value === 'number');

  if (!values.length) {
    return null;
  }

  return Math.min(...values);
}

function getLocalizedReason(
  product: ProductForAnalysis,
  match: ProductMatchResult | undefined,
  language: AppLanguage,
): string {
  const hasLowPhActive =
    (getProductPhMin(match) ?? Number.POSITIVE_INFINITY) <= 4;

  if (product.category === ProductCategory.Cleanser) {
    if (language === 'es') {
      return 'Empieza con el limpiador para retirar acumulación antes de los pasos que se dejan en la piel.';
    }

    return language === 'sv'
      ? 'Börja med rengöringen för att tvätta bort smuts och produktrester.'
      : 'Start with cleanser to rinse away buildup before leave-on steps.';
  }

  if (product.category === ProductCategory.SunProtection) {
    if (language === 'es') {
      return 'Termina con SPF como último paso durante el día.';
    }

    return language === 'sv'
      ? 'Avsluta med SPF som sista steg på dagen.'
      : 'Finish with SPF as the last daytime step.';
  }

  if (hasLowPhActive) {
    if (language === 'es') {
      return 'El paso activo de pH más bajo funciona mejor antes de hidratantes más densos.';
    }

    return language === 'sv'
      ? 'Lågt pH och aktiva ingredienser gör att den bör läggas före tjockare steg.'
      : 'The lower-pH active step is best applied before thicker hydrators.';
  }

  switch (product.category) {
    case ProductCategory.Toner:
    case ProductCategory.Essence:
      if (language === 'es') {
        return 'Este paso ligero y acuoso va antes de sérums y cremas.';
      }

      return language === 'sv'
        ? 'Ett lätt, vattnigt steg som passar före serum och kräm.'
        : 'This lighter watery step fits before serums and creams.';
    case ProductCategory.Serum:
    case ProductCategory.Treatment:
    case ProductCategory.Exfoliant:
      if (language === 'es') {
        return 'Este tratamiento va después de capas acuosas y antes de la hidratante.';
      }

      return language === 'sv'
        ? 'Behandlingssteget kommer efter tunnare lager och före fuktkräm.'
        : 'This treatment step fits after watery layers and before moisturizer.';
    case ProductCategory.Moisturizer:
    case ProductCategory.EyeCare:
    case ProductCategory.LipCare:
      if (language === 'es') {
        return 'Úsalo más tarde para ayudar a sellar la hidratación.';
      }

      return language === 'sv'
        ? 'Det här steget hjälper till att kapsla in fukt senare i rutinen.'
        : 'Use this later to help seal in hydration.';
    case ProductCategory.Mask:
      if (language === 'es') {
        return 'Coloca la mascarilla después de las capas activas según las instrucciones del producto.';
      }

      return language === 'sv'
        ? 'Placera masken efter aktiva steg enligt produktens instruktioner.'
        : 'Place the mask after active layers according to the product directions.';
    case ProductCategory.Other:
    default:
      if (language === 'es') {
        return 'Coloca este paso según la textura y las instrucciones del producto.';
      }

      return language === 'sv'
        ? 'Placera detta steg efter konsistens och produktanvisning.'
        : 'Place this step according to texture and the product directions.';
  }
}

export function buildLayeringOrder(
  products: ProductForAnalysis[],
  matches: ProductMatchResult[],
  language: AppLanguage,
): LayeringStep[] {
  const matchesByProductId = new Map(
    matches.map((match) => [match.product.id, match] as const),
  );

  return [...products]
    .sort((left, right) => {
      const leftWeight = CATEGORY_WEIGHT[left.category];
      const rightWeight = CATEGORY_WEIGHT[right.category];

      if (leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
      }

      const leftPh = getProductPhMin(matchesByProductId.get(left.id));
      const rightPh = getProductPhMin(matchesByProductId.get(right.id));
      if (leftPh !== null || rightPh !== null) {
        return (
          (leftPh ?? Number.POSITIVE_INFINITY) -
          (rightPh ?? Number.POSITIVE_INFINITY)
        );
      }

      return `${left.brand} ${left.name}`.localeCompare(
        `${right.brand} ${right.name}`,
      );
    })
    .map((product) => ({
      productId: product.id,
      brand: product.brand,
      name: product.name,
      reason: getLocalizedReason(
        product,
        matchesByProductId.get(product.id),
        language,
      ),
    }));
}
