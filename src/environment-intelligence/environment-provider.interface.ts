import type {
  EnvironmentLocationLookup,
  EnvironmentProviderLocation,
  EnvironmentProviderSnapshot,
} from './environment-intelligence.types';

export const ENVIRONMENT_PROVIDER = Symbol('ENVIRONMENT_PROVIDER');

export interface EnvironmentProvider {
  resolveLocation(
    lookup: EnvironmentLocationLookup,
  ): Promise<EnvironmentProviderLocation | null>;
  fetchSnapshot(input: {
    latitude: number;
    longitude: number;
    timeZone: string;
    targetDate: string;
    targetTime: string;
  }): Promise<EnvironmentProviderSnapshot | null>;
}
