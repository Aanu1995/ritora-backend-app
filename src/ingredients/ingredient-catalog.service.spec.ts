import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IngredientCatalogService } from './ingredient-catalog.service';

describe('IngredientCatalogService', () => {
  function dataSourceWithRows(rows: unknown[][]): DataSource {
    const query = jest
      .fn()
      .mockResolvedValueOnce(rows[0])
      .mockResolvedValueOnce(rows[1])
      .mockResolvedValueOnce(rows[2])
      .mockResolvedValueOnce(rows[3]);

    return { query } as unknown as DataSource;
  }

  it('loads ingredients, aliases, category fallbacks, and conflict rules from the database', async () => {
    const service = new IngredientCatalogService(
      dataSourceWithRows([
        [
          {
            slug: 'niacinamide',
            category: 'vitamin_b3',
            display_name_en: 'Niacinamide',
            summary_en: 'Supports tone and barrier comfort.',
            ph_min: '5.0',
            ph_max: null,
            ph_sensitive: false,
            photosensitizing: false,
            requires_spf: false,
            irritation_risk: true,
            overlap_severity: 'info',
          },
        ],
        [{ ingredient_slug: 'niacinamide', alias_slug: 'vitamin-b3' }],
        [{ ingredient_slug: 'niacinamide', pattern: 'niacinamide' }],
        [
          {
            code: 'vitamin_c_acid_mix',
            severity: 'warning',
            left_categories: ['vitamin_c'],
            left_ingredient_slugs: null,
            right_categories: null,
            right_ingredient_slugs: ['niacinamide'],
            description_en: 'May irritate sensitive skin.',
            mitigation_en: null,
            conditions: { max_frequency: 'daily' },
            only_when_vitamin_c_is_ph_sensitive: true,
          },
        ],
      ]),
    );

    await service.refresh();

    expect(service.getIngredientBySlug('niacinamide')).toEqual(
      expect.objectContaining({
        slug: 'niacinamide',
        aliases: ['vitamin-b3'],
        phMin: 5,
        phMax: undefined,
        irritationRisk: true,
        phSensitive: undefined,
      }),
    );
    expect(service.getIngredientByAlias('vitamin-b3')?.slug).toBe(
      'niacinamide',
    );
    expect(service.getCategoryFallbacks()[0].pattern.test('niacinamide')).toBe(
      true,
    );
    expect(service.getAllIngredients()).toHaveLength(1);
    expect(service.getConflictRules()).toEqual([
      {
        code: 'vitamin_c_acid_mix',
        severity: 'warning',
        left: { categories: ['vitamin_c'] },
        right: { ingredientSlugs: ['niacinamide'] },
        descriptionEn: 'May irritate sensitive skin.',
        mitigationEn: undefined,
        conditions: { max_frequency: 'daily' },
        onlyWhenVitaminCIsPhSensitive: true,
      },
    ]);
  });

  it('keeps the previous cache when refresh fails', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const dataSource = dataSourceWithRows([
      [
        {
          slug: 'retinol',
          category: 'retinoid',
          display_name_en: 'Retinol',
          summary_en: 'A retinoid.',
          ph_min: null,
          ph_max: null,
          ph_sensitive: false,
          photosensitizing: true,
          requires_spf: true,
          irritation_risk: true,
          overlap_severity: 'warning',
        },
      ],
      [],
      [],
      [],
    ]);
    const service = new IngredientCatalogService(dataSource);

    await service.refresh();
    (dataSource.query as jest.Mock)
      .mockReset()
      .mockRejectedValueOnce(new Error('catalogue table missing'));

    await service.refresh();

    expect(service.getIngredientBySlug('retinol')).toEqual(
      expect.objectContaining({ slug: 'retinol', requiresSpf: true }),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ingredient catalogue refresh skipped'),
    );
    loggerSpy.mockRestore();
  });
});
