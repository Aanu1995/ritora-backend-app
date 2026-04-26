import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { resolveRequestLanguage, translateErrorMessage } from '../i18n/i18n';
import { nowDate, toIsoString } from '../utils/date';

type StructuredFieldErrors = Record<string, string[]>;

function isStructuredFieldErrors(
  value: unknown,
): value is StructuredFieldErrors {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.values(value).every(
    (entry) =>
      Array.isArray(entry) &&
      entry.every((message) => typeof message === 'string'),
  );
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const language = resolveRequestLanguage(request);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json({
      statusCode: status,
      ...this.getExceptionPayload(exception, language),
      timestamp: toIsoString(nowDate()),
      path: request.url,
    });
  }

  private getExceptionPayload(
    exception: unknown,
    language: ReturnType<typeof resolveRequestLanguage>,
  ): Record<string, string | string[] | number | StructuredFieldErrors> {
    if (!(exception instanceof HttpException)) {
      return {
        message: translateErrorMessage(language, 'Internal server error'),
      };
    }

    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      return {
        message: translateErrorMessage(language, exceptionResponse),
      };
    }

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const payload: Record<
        string,
        string | string[] | number | StructuredFieldErrors
      > = {};
      const code =
        'code' in exceptionResponse &&
        typeof exceptionResponse.code === 'string'
          ? exceptionResponse.code
          : undefined;
      const fieldErrors =
        'fieldErrors' in exceptionResponse
          ? exceptionResponse.fieldErrors
          : undefined;

      if ('message' in exceptionResponse) {
        const rawMessage = exceptionResponse.message as string | string[];

        payload.message = Array.isArray(rawMessage)
          ? rawMessage.map((message) =>
              translateErrorMessage(language, message, code),
            )
          : translateErrorMessage(language, rawMessage, code);
      } else {
        payload.message = translateErrorMessage(
          language,
          exception.message,
          code,
        );
      }

      if (code) {
        payload.code = code;
      }

      if (isStructuredFieldErrors(fieldErrors)) {
        payload.fieldErrors = Object.fromEntries(
          Object.entries(fieldErrors).map(([field, messages]) => [
            field,
            messages.map((message) => translateErrorMessage(language, message)),
          ]),
        );
      }

      return payload;
    }

    return { message: exception.message };
  }
}
