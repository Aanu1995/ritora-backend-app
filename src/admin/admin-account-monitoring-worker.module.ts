import { Module } from '@nestjs/common';
import { AdminAccountMonitoringWorkerRuntimeModule } from './admin-account-monitoring-worker-runtime.module';
import { AdminAccountMonitoringWorkerService } from './admin-account-monitoring-worker.service';
import { AdminModule } from './admin.module';

@Module({
  imports: [AdminAccountMonitoringWorkerRuntimeModule, AdminModule],
  providers: [AdminAccountMonitoringWorkerService],
})
export class AdminAccountMonitoringWorkerModule {}
