import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export const ScheduleErrorCode = {
  CustomLabelRequired: 'SCHEDULE_CUSTOM_LABEL_REQUIRED',
  MoveConflict: 'SCHEDULE_MOVE_CONFLICT',
  ProductsNotOwned: 'SCHEDULE_PRODUCTS_NOT_OWNED',
  RequiresProduct: 'SCHEDULE_REQUIRES_PRODUCT',
  SlotConflict: 'SCHEDULE_SLOT_CONFLICT',
  SlotNotFound: 'SCHEDULE_SLOT_NOT_FOUND',
  TooManySteps: 'SCHEDULE_TOO_MANY_STEPS',
} as const;

type ScheduleErrorCodeValue =
  (typeof ScheduleErrorCode)[keyof typeof ScheduleErrorCode];

function withCode(code: ScheduleErrorCodeValue, message: string) {
  return { code, message };
}

export function scheduleCustomLabelRequired() {
  return new BadRequestException(
    withCode(
      ScheduleErrorCode.CustomLabelRequired,
      'customLabel is required when stepLabel is "custom"',
    ),
  );
}

export function scheduleMoveConflict() {
  return new ConflictException(
    withCode(
      ScheduleErrorCode.MoveConflict,
      'A slot already exists at the destination day and time',
    ),
  );
}

export function scheduleProductsNotOwned(productIds: string[]) {
  return new ForbiddenException(
    withCode(
      ScheduleErrorCode.ProductsNotOwned,
      `Products not on your shelf: ${productIds.join(', ')}`,
    ),
  );
}

export function scheduleRequiresProduct() {
  return new BadRequestException(
    withCode(
      ScheduleErrorCode.RequiresProduct,
      'Add at least one product before creating a schedule',
    ),
  );
}

export function scheduleSlotConflict() {
  return new ConflictException(
    withCode(
      ScheduleErrorCode.SlotConflict,
      'A slot already exists at that day and time',
    ),
  );
}

export function scheduleSlotNotFound() {
  return new NotFoundException(
    withCode(ScheduleErrorCode.SlotNotFound, 'Slot not found'),
  );
}

export function scheduleTooManySteps(maxSteps: number) {
  return new BadRequestException(
    withCode(
      ScheduleErrorCode.TooManySteps,
      `Cannot add more than ${maxSteps} steps`,
    ),
  );
}
