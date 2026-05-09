import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersModule } from '../users/users.module';
import { EnvironmentLocationCache } from './entities/environment-location-cache.entity';
import { EnvironmentSnapshot } from './entities/environment-snapshot.entity';
import { EnvironmentContextService } from './environment-context.service';
import { ENVIRONMENT_PROVIDER } from './environment-provider.interface';
import { OpenMeteoEnvironmentProvider } from './open-meteo-environment.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EnvironmentLocationCache,
      EnvironmentSnapshot,
      UserConsent,
    ]),
    UsersModule,
  ],
  providers: [
    EnvironmentContextService,
    OpenMeteoEnvironmentProvider,
    {
      provide: ENVIRONMENT_PROVIDER,
      useExisting: OpenMeteoEnvironmentProvider,
    },
  ],
  exports: [EnvironmentContextService, TypeOrmModule],
})
export class EnvironmentIntelligenceModule {}
