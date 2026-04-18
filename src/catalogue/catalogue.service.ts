import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  decodeCursor,
  encodeCursor,
  type PaginatedResult,
} from '../common/utils/cursor-pagination';
import { assertSafeExternalHttpUrl } from '../common/utils/url-security';
import { DataProvenance } from '../shelf/shelf.types';
import { CatalogueSearchQueryDto } from './dto/catalogue-search-query.dto';
import { CatalogueSuggestionResponseDto } from './dto/catalogue-suggestion-response.dto';
import { ResolvedLookupResponseDto } from './dto/resolved-lookup-response.dto';
import { CatalogueProduct } from './entities/catalogue-product.entity';

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function normalizeBarcode(value: string): string {
  return value.trim();
}

type CatalogueCursorTuple = [number, string, string, string];

@Injectable()
export class CatalogueService {
  constructor(
    @InjectRepository(CatalogueProduct)
    private readonly catalogueRepository: Repository<CatalogueProduct>,
  ) {}

  async search(
    query: CatalogueSearchQueryDto,
  ): Promise<PaginatedResult<CatalogueSuggestionResponseDto>> {
    const normalizedQuery = normalizeSearchValue(query.q);
    const fingerprint = `catalogue:${normalizedQuery}:${query.limit}`;

    if (normalizedQuery.length < 2) {
      return {
        items: [],
        nextCursor: null,
      };
    }

    const searchLike = `%${normalizedQuery}%`;
    const prefixQuery = `${normalizedQuery}%`;
    const brandExpression = `LOWER(COALESCE(product.brand_search, product.brand))`;
    const nameExpression = `LOWER(COALESCE(product.name_search, product.name))`;
    const relevanceExpression = `CASE
      WHEN ${brandExpression} = :exactQuery OR ${nameExpression} = :exactQuery THEN 0
      WHEN ${brandExpression} LIKE :prefixQuery OR ${nameExpression} LIKE :prefixQuery THEN 1
      ELSE 2
    END`;

    const queryBuilder = this.catalogueRepository
      .createQueryBuilder('product')
      .addSelect(relevanceExpression, 'relevance')
      .where(
        new Brackets((qb) => {
          qb.where(`${brandExpression} LIKE :searchLike`).orWhere(
            `${nameExpression} LIKE :searchLike`,
          );
        }),
      )
      .setParameters({
        exactQuery: normalizedQuery,
        prefixQuery,
        searchLike,
      });

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (decoded.fingerprint !== fingerprint) {
        throw new BadRequestException('Cursor does not match this request');
      }

      const [relevance, brand, name, id] =
        decoded.tuple as CatalogueCursorTuple;

      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where(`${relevanceExpression} > :cursorRelevance`, {
            cursorRelevance: Number(relevance),
          })
            .orWhere(
              new Brackets((inner) => {
                inner
                  .where(`${relevanceExpression} = :cursorRelevance`, {
                    cursorRelevance: Number(relevance),
                  })
                  .andWhere(`${brandExpression} > :cursorBrand`, {
                    cursorBrand: String(brand),
                  });
              }),
            )
            .orWhere(
              new Brackets((inner) => {
                inner
                  .where(`${relevanceExpression} = :cursorRelevance`, {
                    cursorRelevance: Number(relevance),
                  })
                  .andWhere(`${brandExpression} = :cursorBrand`, {
                    cursorBrand: String(brand),
                  })
                  .andWhere(`${nameExpression} > :cursorName`, {
                    cursorName: String(name),
                  });
              }),
            )
            .orWhere(
              new Brackets((inner) => {
                inner
                  .where(`${relevanceExpression} = :cursorRelevance`, {
                    cursorRelevance: Number(relevance),
                  })
                  .andWhere(`${brandExpression} = :cursorBrand`, {
                    cursorBrand: String(brand),
                  })
                  .andWhere(`${nameExpression} = :cursorName`, {
                    cursorName: String(name),
                  })
                  .andWhere(`product.id > :cursorId`, {
                    cursorId: String(id),
                  });
              }),
            );
        }),
      );
    }

    const { entities, raw } = await queryBuilder
      .orderBy('relevance', 'ASC')
      .addOrderBy(brandExpression, 'ASC')
      .addOrderBy(nameExpression, 'ASC')
      .addOrderBy('product.id', 'ASC')
      .take(query.limit + 1)
      .getRawAndEntities();

    const hasMore = entities.length > query.limit;
    const pageEntities = hasMore ? entities.slice(0, query.limit) : entities;
    const pageRaw: Array<Record<string, unknown>> = hasMore
      ? (raw.slice(0, query.limit) as Array<Record<string, unknown>>)
      : (raw as Array<Record<string, unknown>>);
    const items = pageEntities.map((product) =>
      CatalogueSuggestionResponseDto.fromEntity(product),
    );
    const nextCursor = this.buildNextCursor(
      pageEntities.at(-1),
      pageRaw.at(-1),
      fingerprint,
      hasMore,
    );

    return { items, nextCursor };
  }

  async resolveBarcode(
    barcode: string,
  ): Promise<ResolvedLookupResponseDto | null> {
    const normalizedBarcode = normalizeBarcode(barcode);
    if (!normalizedBarcode) {
      return null;
    }

    if (normalizedBarcode.length > 64) {
      throw new BadRequestException('Invalid barcode');
    }

    const product = await this.catalogueRepository.findOne({
      where: { barcode: normalizedBarcode },
    });

    if (!product) {
      return null;
    }

    return ResolvedLookupResponseDto.fromEntity(
      product,
      DataProvenance.BarcodeLookup,
    );
  }

  async resolveUrl(url: string): Promise<ResolvedLookupResponseDto | null> {
    assertSafeExternalHttpUrl(url, 'Resolve URL');

    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return null;
    }

    const product = await this.catalogueRepository
      .createQueryBuilder('product')
      .where(
        `LOWER(REGEXP_REPLACE(COALESCE(product.manufacturer->>'productUrl', ''), '/+$', '')) = :url`,
        { url: normalizedUrl },
      )
      .getOne();

    if (!product) {
      return null;
    }

    return ResolvedLookupResponseDto.fromEntity(
      product,
      DataProvenance.UrlFetch,
    );
  }

  private buildNextCursor(
    product: CatalogueProduct | undefined,
    rawProduct: Record<string, unknown> | undefined,
    fingerprint: string,
    hasMore: boolean,
  ): string | null {
    if (!hasMore || !product || !rawProduct) {
      return null;
    }

    const relevance =
      typeof rawProduct.relevance === 'number'
        ? rawProduct.relevance
        : Number(rawProduct.relevance ?? 2);

    return encodeCursor({
      fingerprint,
      tuple: [
        relevance,
        normalizeSearchValue(product.brand),
        normalizeSearchValue(product.name),
        product.id,
      ],
    });
  }
}
