import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import type { DynamicModule, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { ApplicationLogVersion } from '../application-tracking/entities/application-log-version.entity';
import { AppConfigModule } from '../config/app-config.module';
import { RoutineStep } from '../schedule/entities/routine-step.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { SuggestionGapAction } from '../suggestions/entities/suggestion-gap-action.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { SmartPicksGenerationWorker } from './services/smart-picks-generation-worker.service';
import { SmartPicksGenerationWorkerModule } from './smart-picks-generation-worker.module';
import { SmartPicksModule } from './smart-picks.module';
import { SmartPicksWorkerRuntimeModule } from './smart-picks-worker-runtime.module';

type ModuleImport = Type<unknown> | DynamicModule;

function moduleImports(moduleClass: Type<unknown>): ModuleImport[] {
  return (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ??
    []) as ModuleImport[];
}

function moduleProviders(moduleClass: Type<unknown>): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleClass) ?? [];
}

function isDynamicModule(
  moduleImport: ModuleImport,
): moduleImport is DynamicModule {
  return (
    typeof moduleImport === 'object' &&
    moduleImport !== null &&
    'module' in moduleImport
  );
}

function providerToken(
  provider: NonNullable<DynamicModule['providers']>[number],
): unknown {
  if (typeof provider === 'function') {
    return provider;
  }

  if (
    typeof provider === 'object' &&
    provider !== null &&
    'provide' in provider
  ) {
    return provider.provide;
  }

  return null;
}

function smartPicksTypeOrmProviderTokens(): unknown[] {
  const typeOrmImport = moduleImports(SmartPicksModule).find(
    (moduleImport): moduleImport is DynamicModule =>
      isDynamicModule(moduleImport) && moduleImport.module === TypeOrmModule,
  );

  return (typeOrmImport?.providers ?? []).map(providerToken);
}

describe('Smart Picks worker modules', () => {
  it('keeps generation polling out of the API module and in the standalone worker module', () => {
    expect(moduleImports(SmartPicksWorkerRuntimeModule)).toContain(
      AppConfigModule,
    );
    expect(moduleProviders(SmartPicksModule)).not.toContain(
      SmartPicksGenerationWorker,
    );
    expect(moduleImports(SmartPicksGenerationWorkerModule)).toEqual(
      expect.arrayContaining([SmartPicksWorkerRuntimeModule, SmartPicksModule]),
    );
    expect(moduleProviders(SmartPicksGenerationWorkerModule)).toContain(
      SmartPicksGenerationWorker,
    );
  });

  it('registers the suggestion relation entities needed by Smart Picks gap actions', () => {
    expect(smartPicksTypeOrmProviderTokens()).toEqual(
      expect.arrayContaining([
        getRepositoryToken(SuggestionGapAction),
        getRepositoryToken(SuggestionInstance),
        getRepositoryToken(SuggestionStep),
        getRepositoryToken(ScheduleSlot),
        getRepositoryToken(RoutineStep),
        getRepositoryToken(ApplicationLog),
        getRepositoryToken(ApplicationLogItem),
        getRepositoryToken(ApplicationLogVersion),
      ]),
    );
  });
});
