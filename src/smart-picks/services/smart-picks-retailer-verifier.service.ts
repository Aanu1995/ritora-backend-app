import { Injectable } from '@nestjs/common';
import { isSafeExternalHttpUrl } from '../../common/utils/url-security';
import { SmartPickProductSuggestion } from '../entities/smart-pick-product-suggestion.entity';
import {
  SmartPicksAvailabilityStatus,
  SmartPicksProductVerificationStatus,
  SmartPicksRetailer,
} from '../smart-picks.types';
import { GeneratedSmartPick } from './smart-picks-ai-generator';

const RETAILER_VERIFY_TIMEOUT_MS = 2_500;
const RETAILER_VERIFY_REDIRECT_LIMIT = 2;
const RETAILER_DATA_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

type VerifiedRetailers = {
  retailers: SmartPicksRetailer[];
  verifiedCount: number;
};

@Injectable()
export class SmartPicksRetailerVerifierService {
  async verifyGeneratedPick(
    pick: GeneratedSmartPick,
  ): Promise<GeneratedSmartPick> {
    const verifiedRetailers = await this.verifyRetailers(pick.retailers);
    const alternatives = await Promise.all(
      pick.alternatives.map(async (alternative) => {
        const verifiedAlternativeRetailers = await this.verifyRetailers(
          alternative.retailers,
        );
        const verificationStatus = verificationStatusForRetailers(
          verifiedAlternativeRetailers,
        );
        return {
          ...alternative,
          retailers: verifiedAlternativeRetailers.retailers,
          verificationStatus,
          availabilityStatus: availabilityStatusAfterVerification(
            alternative.availabilityStatus,
            verifiedAlternativeRetailers,
          ),
          alternatives: [],
        };
      }),
    );
    const verificationStatus =
      verificationStatusForRetailers(verifiedRetailers);

    return {
      ...pick,
      retailers: verifiedRetailers.retailers,
      alternatives,
      verificationStatus,
      availabilityStatus: availabilityStatusAfterVerification(
        pick.availabilityStatus,
        verifiedRetailers,
      ),
    };
  }

  async verifyStoredSuggestion(
    suggestion: SmartPickProductSuggestion,
  ): Promise<SmartPickProductSuggestion> {
    const verifiedRetailers = await this.verifyRetailers(
      suggestion.retailers_json ?? [],
    );
    const alternatives = await Promise.all(
      (suggestion.alternatives_json ?? []).map(async (alternative) => {
        const verifiedAlternativeRetailers = await this.verifyRetailers(
          alternative.retailers ?? [],
        );
        return {
          ...alternative,
          retailers: verifiedAlternativeRetailers.retailers,
          availabilityStatus: availabilityStatusAfterVerification(
            alternative.availabilityStatus,
            verifiedAlternativeRetailers,
          ),
        };
      }),
    );
    const now = new Date();

    return Object.assign(suggestion, {
      retailers_json: verifiedRetailers.retailers,
      alternatives_json: alternatives,
      verification_status: verificationStatusForRetailers(verifiedRetailers),
      availability_status: availabilityStatusAfterVerification(
        suggestion.availability_status,
        verifiedRetailers,
      ),
      retailer_data_checked_at: now,
      retailer_data_expires_at: new Date(
        now.getTime() + RETAILER_DATA_FRESHNESS_MS,
      ),
    });
  }

  private async verifyRetailers(
    retailers: readonly SmartPicksRetailer[],
  ): Promise<VerifiedRetailers> {
    const safeRetailers = retailers.filter((retailer) =>
      isSafeExternalHttpUrl(retailer.url),
    );
    const checked = await Promise.all(
      safeRetailers.map(async (retailer) => ({
        retailer,
        reachable: await verifyRetailerUrl(retailer.url),
      })),
    );

    return {
      retailers: checked.map(({ retailer, reachable }) => ({
        ...retailer,
        inStock: retailer.inStock && reachable,
      })),
      verifiedCount: checked.filter(({ reachable }) => reachable).length,
    };
  }
}

async function verifyRetailerUrl(url: string): Promise<boolean> {
  if (!isSafeExternalHttpUrl(url)) return false;
  const headResult = await fetchWithRedirectChecks(url, 'HEAD', 0);
  if (headResult === 'method_not_allowed') {
    return fetchWithRedirectChecks(url, 'GET', 0).then(
      (result) => result === 'reachable',
    );
  }
  return headResult === 'reachable';
}

async function fetchWithRedirectChecks(
  url: string,
  method: 'GET' | 'HEAD',
  redirectCount: number,
): Promise<'reachable' | 'unreachable' | 'method_not_allowed'> {
  if (!isSafeExternalHttpUrl(url)) return 'unreachable';

  try {
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
      signal: AbortSignal.timeout(RETAILER_VERIFY_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= RETAILER_VERIFY_REDIRECT_LIMIT) {
        return 'unreachable';
      }
      const location = response.headers.get('location');
      if (!location) return 'unreachable';
      const nextUrl = new URL(location, url).toString();
      return fetchWithRedirectChecks(nextUrl, method, redirectCount + 1);
    }
    if (response.status === 405 && method === 'HEAD') {
      return 'method_not_allowed';
    }
    return isReachableStatus(response.status) ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

function isReachableStatus(status: number): boolean {
  if (status === 404 || status === 410) return false;
  if (status >= 500) return false;
  return status >= 200 && status < 500;
}

function verificationStatusForRetailers(
  result: VerifiedRetailers,
): SmartPicksProductVerificationStatus {
  return result.verifiedCount > 0 ? 'retailer_verified' : 'retailer_unverified';
}

function availabilityStatusAfterVerification(
  current: SmartPicksAvailabilityStatus,
  result: VerifiedRetailers,
): SmartPicksAvailabilityStatus {
  if (result.verifiedCount > 0) {
    return current === 'unavailable' ? 'unknown' : current;
  }
  return current === 'unavailable' ? 'unavailable' : 'unknown';
}
