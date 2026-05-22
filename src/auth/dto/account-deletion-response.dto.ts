import { ApiProperty } from '@nestjs/swagger';

export enum AccountDeletionStatus {
  Scheduled = 'scheduled',
  ConfirmationRequired = 'confirmation_required',
}

export class AccountDeletionResponseDto {
  @ApiProperty({ enum: AccountDeletionStatus })
  status: AccountDeletionStatus;

  @ApiProperty()
  message: string;

  @ApiProperty({ required: false })
  scheduledFor?: string;

  constructor(
    status: AccountDeletionStatus,
    message: string,
    scheduledFor?: string,
  ) {
    this.status = status;
    this.message = message;
    this.scheduledFor = scheduledFor;
  }
}
