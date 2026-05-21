import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { HealthCheckResponse, HealthCheckStatus } from './health.types';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @ApiOkResponse({ description: 'Service health check.' })
  async check(): Promise<HealthCheckResponse> {
    const response = await this.healthService.check();
    if (response.status === HealthCheckStatus.Down) {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }
}
