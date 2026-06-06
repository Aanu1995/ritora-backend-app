import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import {
  RequireUnrestrictedUserCapabilities,
  UserRestrictionGuard,
} from '../users/user-restriction.guard';
import { UserRestrictionCapability } from '../users/user-restrictions';
import { CreateSupportFeedbackDto } from './dto/support-feedback.dto';
import { SupportService } from './support.service';
import { type UserSupportFeedbackCreatedResponse } from './support.types';

function getHeaderValue(
  headers: Request['headers'],
  key: string,
): string | undefined {
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

@ApiTags('support')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('feedback')
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableSupportContact,
  )
  @UseGuards(OriginCheckGuard, UserRestrictionGuard)
  createFeedback(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSupportFeedbackDto,
    @Req() req: Request,
  ): Promise<UserSupportFeedbackCreatedResponse> {
    return this.supportService.createUserFeedback(
      userId,
      {
        context: dto.context,
        description: dto.description,
        title: dto.title,
        type: dto.type,
      },
      {
        ip: req.ip,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }
}
