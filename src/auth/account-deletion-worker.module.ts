import { Module } from '@nestjs/common';
import { AuthModule } from './auth.module';
import { AccountDeletionWorkerRuntimeModule } from './account-deletion-worker-runtime.module';
import { AccountDeletionWorkerService } from './account-deletion-worker.service';

@Module({
  imports: [AccountDeletionWorkerRuntimeModule, AuthModule],
  providers: [AccountDeletionWorkerService],
})
export class AccountDeletionWorkerModule {}
