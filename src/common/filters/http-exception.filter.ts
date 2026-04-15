import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json({
      statusCode: status,
      ...this.getExceptionPayload(exception),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private getExceptionPayload(
    exception: unknown,
  ): Record<string, string | string[] | number> {
    if (!(exception instanceof HttpException)) {
      return { message: 'Internal server error' };
    }

    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      return { message: exceptionResponse };
    }

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const payload: Record<string, string | string[] | number> = {};

      if ('message' in exceptionResponse) {
        payload.message = exceptionResponse.message as string | string[];
      } else {
        payload.message = exception.message;
      }

      if ('code' in exceptionResponse) {
        payload.code = exceptionResponse.code as string;
      }

      return payload;
    }

    return { message: exception.message };
  }
}
