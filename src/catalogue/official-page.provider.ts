import { Injectable, Logger } from '@nestjs/common';
import { assertSafeExternalHttpUrl } from '../common/utils/url-security';
import type { OfficialPageExtraction } from './product-discovery.types';
import { extractOfficialPageExtraction } from './official-page-extraction.utils';

const REQUEST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'User-Agent': 'Ritora/1.0 (+https://getritora.com)',
};
const REQUEST_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;
const MAX_HTML_LENGTH = 400_000;

@Injectable()
export class OfficialPageProvider {
  private readonly logger = new Logger(OfficialPageProvider.name);

  async extract(url: string): Promise<OfficialPageExtraction | null> {
    assertSafeExternalHttpUrl(url, 'Official product page');

    const html = await this.fetchHtml(url);
    if (!html) {
      return null;
    }

    return extractOfficialPageExtraction(html, url);
  }

  private async fetchHtml(
    url: string,
    redirectCount = 0,
  ): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (
        response.status >= 300 &&
        response.status < 400 &&
        redirectCount < MAX_REDIRECTS
      ) {
        const location = response.headers.get('location');
        if (!location) {
          return null;
        }

        const nextUrl = new URL(location, url).toString();
        assertSafeExternalHttpUrl(nextUrl, 'Official product page redirect');
        return this.fetchHtml(nextUrl, redirectCount + 1);
      }

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('text/html')) {
        return null;
      }

      return (await response.text()).slice(0, MAX_HTML_LENGTH);
    } catch (error) {
      this.logger.warn(
        `Official page request failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return null;
    }
  }
}
