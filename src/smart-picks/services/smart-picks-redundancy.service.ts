import { Injectable } from '@nestjs/common';
import { AppLanguage, DEFAULT_LANGUAGE } from '../../common/i18n/i18n';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { detectActiveTags } from '../../suggestions/services/suggestion-product-intelligence';
import { SmartPicksRedundancyGroup } from '../smart-picks.types';
import { smartPicksRedundancyHint } from './smart-picks-localization';

@Injectable()
export class SmartPicksRedundancyService {
  detect(
    activeProducts: InventoryProduct[],
    language: AppLanguage = DEFAULT_LANGUAGE,
  ): SmartPicksRedundancyGroup[] {
    const productsByTag = new Map<string, InventoryProduct[]>();
    for (const product of activeProducts) {
      for (const tag of detectActiveTags(product)) {
        const list = productsByTag.get(tag) ?? [];
        list.push(product);
        productsByTag.set(tag, list);
      }
    }

    return Array.from(productsByTag.entries())
      .filter(([, products]) => products.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([activeTag, products]) => ({
        activeTag,
        products: products
          .slice()
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
          .map((product, index) => ({
            id: product.id,
            brand: product.brand,
            name: product.name,
            recommendation:
              index === 0 ? 'keep' : index === 1 ? 'finish-first' : 'redundant',
          })),
        hint: smartPicksRedundancyHint(activeTag, products.length, language),
      }));
  }
}
