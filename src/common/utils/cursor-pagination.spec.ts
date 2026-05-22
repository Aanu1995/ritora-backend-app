import { BadRequestException } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  paginateByCursor,
} from './cursor-pagination';

describe('cursor-pagination utilities', () => {
  const items = [
    { id: 'a', createdAt: '2026-05-01T08:00:00.000Z' },
    { id: 'b', createdAt: '2026-05-01T09:00:00.000Z' },
    { id: 'c', createdAt: '2026-05-01T10:00:00.000Z' },
  ];
  const tuple = (item: (typeof items)[number]) => [item.createdAt, item.id];

  it('encodes and decodes opaque cursor payloads', () => {
    const cursor = encodeCursor({
      fingerprint: 'photos:user-1',
      tuple: ['2026-05-01', 'entry-1'],
    });

    expect(decodeCursor(cursor)).toEqual({
      fingerprint: 'photos:user-1',
      tuple: ['2026-05-01', 'entry-1'],
    });
  });

  it('paginates from the beginning and returns the next cursor', () => {
    const firstPage = paginateByCursor(items, 2, null, 'photos:user-1', tuple);

    expect(firstPage.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = paginateByCursor(
      items,
      2,
      firstPage.nextCursor,
      'photos:user-1',
      tuple,
    );
    expect(secondPage).toEqual({
      items: [items[2]],
      nextCursor: null,
    });
  });

  it('rejects malformed, mismatched, and stale cursors', () => {
    expect(() => decodeCursor('not-json')).toThrow(BadRequestException);

    expect(() =>
      paginateByCursor(
        items,
        2,
        encodeCursor({ fingerprint: 'other-request', tuple: tuple(items[0]) }),
        'photos:user-1',
        tuple,
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      paginateByCursor(
        items,
        2,
        encodeCursor({
          fingerprint: 'photos:user-1',
          tuple: ['2026-04-01', 'missing'],
        }),
        'photos:user-1',
        tuple,
      ),
    ).toThrow(BadRequestException);
  });
});
