import type {
  ProductCheckEvaluation,
  ProductCheckProductInput,
} from './product-check.types';
import type {
  ProductCompareItemKind,
  ProductCompareItemResult,
} from './product-compare.types';

export type ResolvedCompareItem = {
  itemId: string;
  kind: ProductCompareItemKind;
  productId: string | null;
  product: ProductCheckProductInput;
  isOwnedShelfProduct: boolean;
};

export type EvaluatedCompareItem = ResolvedCompareItem & {
  evaluation: ProductCheckEvaluation;
  result: ProductCompareItemResult;
  score: number;
};
