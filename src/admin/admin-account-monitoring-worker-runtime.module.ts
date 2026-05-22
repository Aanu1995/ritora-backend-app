import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../config/app-config.module';
import { databaseConfig } from '../config/database.config';

@Module({
  imports: [AppConfigModule, TypeOrmModule.forRootAsync(databaseConfig)],
})
export class AdminAccountMonitoringWorkerRuntimeModule {}
