import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export type ValidationFieldErrors = Record<string, string[]>;

type ValidationErrorPayload = {
  statusCode: HttpStatus.BAD_REQUEST;
  message: string[];
  fieldErrors: ValidationFieldErrors;
};

function appendMessages(
  target: ValidationFieldErrors,
  path: string,
  messages: string[],
): void {
  if (!path || messages.length === 0) {
    return;
  }

  const nextMessages = Array.from(
    new Set(messages.filter((message) => message.length > 0)),
  );

  if (nextMessages.length === 0) {
    return;
  }

  target[path] = nextMessages;
}

function collectValidationErrors(
  errors: ValidationError[],
  parentPath = '',
  fieldErrors: ValidationFieldErrors = {},
  messages: string[] = [],
): ValidationErrorPayload {
  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const constraintMessages = Object.values(error.constraints ?? {}).filter(
      (message): message is string => typeof message === 'string',
    );

    appendMessages(fieldErrors, path, constraintMessages);
    messages.push(...constraintMessages);

    if (error.children?.length) {
      collectValidationErrors(error.children, path, fieldErrors, messages);
    }
  }

  return {
    statusCode: HttpStatus.BAD_REQUEST,
    message: Array.from(
      new Set(messages.filter((message) => message.length > 0)),
    ),
    fieldErrors,
  };
}

export function buildValidationExceptionPayload(
  errors: ValidationError[],
): ValidationErrorPayload {
  return collectValidationErrors(errors);
}

export function createValidationException(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException(buildValidationExceptionPayload(errors));
}
