import { BadRequestException } from '@nestjs/common';
import {
  assertSafeExternalHttpUrl,
  assertSafeInventoryImageUrl,
  isSafeExternalHttpUrl,
  isSafeInventoryImageUrl,
} from './url-security';

describe('url security helpers', () => {
  const originalApiPort = process.env.API_PORT;

  afterEach(() => {
    if (originalApiPort === undefined) {
      delete process.env.API_PORT;
    } else {
      process.env.API_PORT = originalApiPort;
    }
  });

  it.each(['https://example.com/product', 'http://shop.example.com/item'])(
    'allows public HTTP(S) URL %s',
    (url) => {
      expect(isSafeExternalHttpUrl(url)).toBe(true);
      expect(() => assertSafeExternalHttpUrl(url, 'url')).not.toThrow();
    },
  );

  it.each([
    'ftp://example.com/file',
    'javascript:alert(1)',
    'https://user:pass@example.com',
    'http://localhost:3000/private',
    'http://app.local/image',
    'http://service.internal/image',
    'http://127.0.0.1:3001/image',
    'http://0.0.0.0/image',
    'http://10.0.0.1/image',
    'http://172.16.0.1/image',
    'http://172.31.255.255/image',
    'http://192.168.1.1/image',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/image',
    'http://[fc00::1]/image',
    'http://[fd00::1]/image',
    'http://[fe80::1]/image',
    'not a url',
  ])('rejects unsafe external URL %s', (url) => {
    expect(isSafeExternalHttpUrl(url)).toBe(false);
    expect(() => assertSafeExternalHttpUrl(url, 'url')).toThrow(
      BadRequestException,
    );
  });

  it('treats empty assertion values as absent optional URLs', () => {
    expect(() => assertSafeExternalHttpUrl(null, 'url')).not.toThrow();
    expect(() =>
      assertSafeInventoryImageUrl(undefined, 'imageUrl'),
    ).not.toThrow();
  });

  it('allows same-API media URLs while rejecting unsafe media URLs', () => {
    process.env.API_PORT = '4010';

    expect(
      isSafeInventoryImageUrl('http://localhost:4010/media/products/one.jpg'),
    ).toBe(true);
    expect(
      isSafeInventoryImageUrl('https://127.0.0.1:4010/media/products/one.jpg'),
    ).toBe(true);
    expect(
      isSafeInventoryImageUrl('http://localhost:4010/private/products/one.jpg'),
    ).toBe(false);
    expect(isSafeInventoryImageUrl('https://example.com/product.jpg')).toBe(
      true,
    );
    expect(isSafeInventoryImageUrl('notaurl')).toBe(false);
    expect(() =>
      assertSafeInventoryImageUrl('http://localhost:4010/private.jpg', 'image'),
    ).toThrow(BadRequestException);
  });
});
