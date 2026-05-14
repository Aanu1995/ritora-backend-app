import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { SmartPickGenerationJob } from './entities/smart-pick-generation-job.entity';
import { SmartPicksGenerationWorker } from './services/smart-picks-generation-worker.service';
import { SmartPicksWorkerRuntimeModule } from './smart-picks-worker-runtime.module';
import { SmartPicksModule } from './smart-picks.module';

@Module({
  imports: [
    SmartPicksWorkerRuntimeModule,
    SmartPicksModule,
    TypeOrmModule.forFeature([SmartPickGenerationJob, User]),
  ],
  providers: [SmartPicksGenerationWorker],
})
export class SmartPicksGenerationWorkerModule {}
