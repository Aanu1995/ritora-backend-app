import type { DynamicModule, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { ApplicationLogVersion } from '../application-tracking/entities/application-log-version.entity';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { AppConfigModule } from '../config/app-config.module';
import { EnvironmentLocationCache } from '../environment-intelligence/entities/environment-location-cache.entity';
import { EnvironmentSnapshot } from '../environment-intelligence/entities/environment-snapshot.entity';
import { RoutineStep } from '../schedule/entities/routine-step.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { IngredientProductAnalysisWorkerService } from './ingredient-product-analysis-worker.service';
import { IngredientProductAnalysisWorkerModule } from './ingredient-product-analysis-worker.module';
import { IngredientProductAnalysisWorkerRuntimeModule } from './ingredient-product-analysis-worker-runtime.module';
import { IngredientsModule } from './ingredients.module';

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

function ingredientsTypeOrmProviderTokens(): unknown[] {
  const typeOrmImport = moduleImports(IngredientsModule).find(
    (moduleImport): moduleImport is DynamicModule =>
      isDynamicModule(moduleImport) && moduleImport.module === TypeOrmModule,
  );

  return (typeOrmImport?.providers ?? []).map(providerToken);
}

describe('Ingredient product analysis worker modules', () => {
  it('keeps ingredient analysis polling out of the API module and in the standalone worker module', () => {
    expect(
      moduleImports(IngredientProductAnalysisWorkerRuntimeModule),
    ).toContain(AppConfigModule);
    expect(moduleProviders(IngredientsModule)).not.toContain(
      IngredientProductAnalysisWorkerService,
    );
    expect(moduleImports(IngredientProductAnalysisWorkerModule)).toEqual(
      expect.arrayContaining([
        IngredientProductAnalysisWorkerRuntimeModule,
        IngredientsModule,
      ]),
    );
    expect(moduleProviders(IngredientProductAnalysisWorkerModule)).toContain(
      IngredientProductAnalysisWorkerService,
    );
  });

  it('registers relation entities needed by product-check context in the standalone worker graph', () => {
    expect(ingredientsTypeOrmProviderTokens()).toEqual(
      expect.arrayContaining([
        getRepositoryToken(SuggestionInstance),
        getRepositoryToken(SuggestionStep),
        getRepositoryToken(ScheduleSlot),
        getRepositoryToken(RoutineStep),
        getRepositoryToken(EnvironmentSnapshot),
        getRepositoryToken(EnvironmentLocationCache),
        getRepositoryToken(ApplicationLog),
        getRepositoryToken(ApplicationLogItem),
        getRepositoryToken(ApplicationLogVersion),
      ]),
    );
  });
});
