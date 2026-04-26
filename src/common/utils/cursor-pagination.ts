import { BadRequestException } from '@nestjs/common';

export type PaginatedResult<T> = {
  items: T[];
  nextCursor: string | null;
};

type DecodedCursor = {
  fingerprint: string;
  tuple: unknown[];
};

export function encodeCursor(cursor: DecodedCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<DecodedCursor>;

    if (
      typeof parsed.fingerprint !== 'string' ||
      !Array.isArray(parsed.tuple)
    ) {
      throw new Error('Invalid cursor');
    }

    return {
      fingerprint: parsed.fingerprint,
      tuple: parsed.tuple,
    };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

export function paginateByCursor<T>(
  items: T[],
  limit: number,
  cursor: string | null | undefined,
  fingerprint: string,
  getTuple: (item: T) => unknown[],
): PaginatedResult<T> {
  let startIndex = 0;

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded.fingerprint !== fingerprint) {
      throw new BadRequestException('Cursor does not match this request');
    }

    const matchIndex = items.findIndex((item) => {
      const tuple = getTuple(item);
      return JSON.stringify(tuple) === JSON.stringify(decoded.tuple);
    });

    if (matchIndex === -1) {
      throw new BadRequestException('Cursor no longer points to a valid item');
    }

    startIndex = matchIndex + 1;
  }

  const page = items.slice(startIndex, startIndex + limit);
  const lastItem = page[page.length - 1];
  const hasMore = startIndex + limit < items.length;

  return {
    items: page,
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({
            fingerprint,
            tuple: getTuple(lastItem),
          })
        : null,
  };
}
