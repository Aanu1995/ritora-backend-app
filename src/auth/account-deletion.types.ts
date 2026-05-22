export enum AccountDeletionFinalizationDriver {
  Database = 'database',
  EventBridgeSqs = 'eventbridge-sqs',
}

export enum AccountDeletionQueueMessageType {
  Finalize = 'account_deletion.finalize',
}

export type AccountDeletionQueueMessage = {
  userId: string;
  scheduledFor: Date;
  receiptHandle: string;
};
