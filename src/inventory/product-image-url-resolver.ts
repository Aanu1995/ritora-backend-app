import type { InventoryProduct } from './entities/inventory-product.entity';

export type ProductImageUrlResolver = (imageUrls: string[]) => string[];

export type ProductImageUrlResolverOptions = {
  resolveProductImageUrls?: ProductImageUrlResolver;
};

export function resolveInventoryProductImageUrl(
  product: InventoryProduct,
  options: ProductImageUrlResolverOptions = {},
): string | null {
  const imageUrls = product.identity?.imageUrls ?? [];
  const resolvedImageUrls = options.resolveProductImageUrls
    ? options.resolveProductImageUrls(imageUrls)
    : imageUrls;
  return resolvedImageUrls[0] ?? null;
}
