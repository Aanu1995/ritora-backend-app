import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminAccountRole } from './entities/admin-account.entity';

type AdminRequest = Request & {
  user?: {
    role?: unknown;
  };
};

@Injectable()
export class AdminRootGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminRequest>();

    if (request.user?.role !== AdminAccountRole.Root) {
      throw new ForbiddenException('Root admin privileges required');
    }

    return true;
  }
}
