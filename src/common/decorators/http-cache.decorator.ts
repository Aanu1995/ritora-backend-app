import { SetMetadata } from '@nestjs/common';

export enum HttpCachePolicy {
  NoStore = 'no-store',
  AllowBrowserCache = 'allow-browser-cache',
}

export const HTTP_CACHE_POLICY_KEY = 'httpCachePolicy';

export const AllowBrowserCache = () =>
  SetMetadata(HTTP_CACHE_POLICY_KEY, HttpCachePolicy.AllowBrowserCache);
