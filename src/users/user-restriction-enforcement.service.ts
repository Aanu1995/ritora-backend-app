import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import {
  clearUserRestrictionState,
  hasActiveUserRestrictionCapability,
  isUserRestrictionExpired,
  type RestrictableUser,
  UserRestrictionCapability,
} from './user-restrictions';

@Injectable()
export class UserRestrictionEnforcementService {
  constructor(private readonly usersService: UsersService) {}

  async assertAllowed(
    userId: string,
    capability: UserRestrictionCapability,
  ): Promise<void> {
    const user = await this.findUserOrThrow(userId);
    this.assertUserAllowed(user, capability);
  }

  async assertAllAllowed(
    userId: string,
    capabilities: readonly UserRestrictionCapability[],
  ): Promise<void> {
    if (capabilities.length === 0) {
      return;
    }

    const user = await this.findUserOrThrow(userId);
    this.assertAllAllowedForUser(user, capabilities);
  }

  async isCapabilityRestricted(
    userId: string,
    capability: UserRestrictionCapability,
  ): Promise<boolean> {
    const user = await this.usersService.findById(userId);
    if (user) {
      await this.clearExpiredAccountRestrictionIfNeeded(user);
    }
    return this.isCapabilityRestrictedForUser(user, capability);
  }

  assertAllAllowedForUser(
    user: RestrictableUser | null | undefined,
    capabilities: readonly UserRestrictionCapability[],
  ): void {
    if (!user) {
      throw new UnauthorizedException();
    }

    for (const capability of capabilities) {
      this.assertUserAllowed(user, capability);
    }
  }

  isCapabilityRestrictedForUser(
    user: RestrictableUser | null | undefined,
    capability: UserRestrictionCapability,
  ): boolean {
    return user ? hasActiveUserRestrictionCapability(user, capability) : false;
  }

  private async findUserOrThrow(userId: string): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    await this.clearExpiredAccountRestrictionIfNeeded(user);

    return user;
  }

  private async clearExpiredAccountRestrictionIfNeeded(
    user: User,
  ): Promise<void> {
    if (!isUserRestrictionExpired(user)) {
      return;
    }

    await this.usersService.clearExpiredAccountRestriction(user.id);
    clearUserRestrictionState(user);
  }

  private assertUserAllowed(
    user: RestrictableUser,
    capability: UserRestrictionCapability,
  ): void {
    if (!hasActiveUserRestrictionCapability(user, capability)) {
      return;
    }

    throw new ForbiddenException({
      capability,
      code: 'ACCOUNT_RESTRICTION_CAPABILITY_BLOCKED',
      message: 'Account action restricted',
    });
  }
}
