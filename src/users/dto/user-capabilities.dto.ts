import { ApiProperty } from '@nestjs/swagger';

export enum UserFeatureAccessBlockedBy {
  UserRestriction = 'user_restriction',
  PlatformGlobalRestriction = 'platform_global_restriction',
}

export class UserFeatureAccessDto {
  @ApiProperty()
  enabled: boolean;

  @ApiProperty({
    enum: UserFeatureAccessBlockedBy,
    nullable: true,
  })
  blockedBy: UserFeatureAccessBlockedBy | null;

  @ApiProperty({ nullable: true })
  expiresAt: string | null;

  @ApiProperty({ nullable: true })
  message: string | null;

  constructor(
    enabled: boolean,
    blockedBy: UserFeatureAccessBlockedBy | null,
    expiresAt: string | null,
    message: string | null,
  ) {
    this.enabled = enabled;
    this.blockedBy = blockedBy;
    this.expiresAt = expiresAt;
    this.message = message;
  }
}

export class UserCapabilitiesDto {
  @ApiProperty({ type: UserFeatureAccessDto })
  accountCreation: UserFeatureAccessDto;

  @ApiProperty({ type: UserFeatureAccessDto })
  aiGeneration: UserFeatureAccessDto;

  @ApiProperty({ type: UserFeatureAccessDto })
  imageUpload: UserFeatureAccessDto;

  @ApiProperty({ type: UserFeatureAccessDto })
  productExtraction: UserFeatureAccessDto;

  @ApiProperty({ type: UserFeatureAccessDto })
  notifications: UserFeatureAccessDto;

  @ApiProperty({ type: UserFeatureAccessDto })
  supportContact: UserFeatureAccessDto;

  constructor(init: UserCapabilitiesDto) {
    this.accountCreation = init.accountCreation;
    this.aiGeneration = init.aiGeneration;
    this.imageUpload = init.imageUpload;
    this.productExtraction = init.productExtraction;
    this.notifications = init.notifications;
    this.supportContact = init.supportContact;
  }
}

export function createEnabledFeatureAccess(): UserFeatureAccessDto {
  return new UserFeatureAccessDto(true, null, null, null);
}

export function createDefaultUserCapabilities(): UserCapabilitiesDto {
  return new UserCapabilitiesDto({
    accountCreation: createEnabledFeatureAccess(),
    aiGeneration: createEnabledFeatureAccess(),
    imageUpload: createEnabledFeatureAccess(),
    productExtraction: createEnabledFeatureAccess(),
    notifications: createEnabledFeatureAccess(),
    supportContact: createEnabledFeatureAccess(),
  });
}
