import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isSafeExternalHttpUrl } from '../common/utils/url-security';
import {
  CatalogueSourceRule,
  type CatalogueSourceRuleMatchType,
} from './entities/catalogue-source-rule.entity';

type SourceTrustEvaluation = {
  blocked: boolean;
  scoreAdjustment: number;
  matchedLabels: string[];
};

const RULE_CACHE_TTL_MS = 5 * 60 * 1000;
const SUSPICIOUS_COUNTRY_CODE_COM_SUFFIXES = new Set([
  'us.com',
  'uk.com',
  'eu.com',
  'de.com',
  'fr.com',
  'it.com',
  'es.com',
  'jp.com',
  'kr.com',
  'cn.com',
  'au.com',
  'ca.com',
  'se.com',
  'no.com',
  'fi.com',
  'dk.com',
  'nl.com',
  'be.com',
  'br.com',
  'mx.com',
  'za.com',
]);

function matchesSuspiciousCountryCodeSuffix(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 3) {
    return false;
  }

  return SUSPICIOUS_COUNTRY_CODE_COM_SUFFIXES.has(`${parts[1]}.${parts[2]}`);
}

function matchesHostPattern(
  hostname: string,
  pattern: string,
  matchType: CatalogueSourceRuleMatchType,
): boolean {
  if (matchType === 'hostname_equals') {
    return hostname === pattern;
  }

  if (matchType === 'hostname_suffix') {
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  }

  return hostname.includes(pattern);
}

@Injectable()
export class CatalogueSourceRuleService {
  private cachedRules: CatalogueSourceRule[] | null = null;
  private cacheExpiresAt = 0;
  private pendingRulesPromise: Promise<CatalogueSourceRule[]> | null = null;

  constructor(
    @InjectRepository(CatalogueSourceRule)
    private readonly sourceRuleRepository: Repository<CatalogueSourceRule>,
  ) {}

  async evaluateUrl(url: string): Promise<SourceTrustEvaluation> {
    if (!isSafeExternalHttpUrl(url)) {
      return {
        blocked: true,
        scoreAdjustment: Number.NEGATIVE_INFINITY,
        matchedLabels: ['unsafe-external-url'],
      };
    }

    let hostname = '';

    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return {
        blocked: true,
        scoreAdjustment: Number.NEGATIVE_INFINITY,
        matchedLabels: ['invalid-url'],
      };
    }

    if (matchesSuspiciousCountryCodeSuffix(hostname)) {
      return {
        blocked: true,
        scoreAdjustment: Number.NEGATIVE_INFINITY,
        matchedLabels: ['suspicious-country-code-com-host'],
      };
    }

    const rules = await this.getActiveRules();
    const matchedRules = rules.filter((rule) =>
      matchesHostPattern(hostname, rule.host_pattern, rule.match_type),
    );

    if (matchedRules.some((rule) => rule.effect === 'block')) {
      return {
        blocked: true,
        scoreAdjustment: Number.NEGATIVE_INFINITY,
        matchedLabels: matchedRules.map((rule) => rule.label),
      };
    }

    const scoreAdjustment = matchedRules.reduce((total, rule) => {
      return total + rule.score_adjustment;
    }, 0);

    return {
      blocked: false,
      scoreAdjustment,
      matchedLabels: matchedRules.map((rule) => rule.label),
    };
  }

  invalidateCache(): void {
    this.cachedRules = null;
    this.cacheExpiresAt = 0;
    this.pendingRulesPromise = null;
  }

  private async getActiveRules(): Promise<CatalogueSourceRule[]> {
    const now = Date.now();
    if (this.cachedRules && now < this.cacheExpiresAt) {
      return this.cachedRules;
    }

    if (this.pendingRulesPromise) {
      return this.pendingRulesPromise;
    }

    this.pendingRulesPromise = this.sourceRuleRepository
      .find({
        where: { enabled: true },
        order: {
          effect: 'ASC',
          score_adjustment: 'ASC',
          label: 'ASC',
        },
      })
      .then((rules) => {
        this.cachedRules = rules;
        this.cacheExpiresAt = now + RULE_CACHE_TTL_MS;
        return rules;
      })
      .finally(() => {
        this.pendingRulesPromise = null;
      });

    return this.pendingRulesPromise;
  }
}
