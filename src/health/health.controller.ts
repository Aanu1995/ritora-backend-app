import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { nowDate, toIsoString } from '../common/utils/date';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @ApiOkResponse({ description: 'Service health check.' })
  check(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: toIsoString(nowDate()),
    };
  }
}
