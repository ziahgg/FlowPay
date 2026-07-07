import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'http';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

/**
 * Every error response from this API is application/problem+json (RFC 7807) -- a machine-readable
 * `type`/`title`/`status` triple plus a human-readable `detail` for this specific occurrence,
 * instead of every module inventing its own ad-hoc error shape. `requestId` is an RFC 7807
 * extension member, correlating an error response back to the structured pino log line the
 * unhandled exception produced.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const title = STATUS_CODES[status] ?? 'Error';
    const detail = isHttpException
      ? this.extractDetail(exception.getResponse(), exception.message)
      : 'Internal server error';

    const requestId = request.headers[REQUEST_ID_HEADER] as string | undefined;

    this.logger.error(
      { err: exception, requestId, path: request.url, statusCode: status },
      'Unhandled exception',
    );

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://flowpay.dev/problems/${this.slugify(title)}`,
        title,
        status,
        detail,
        instance: request.url,
        requestId,
      });
  }

  private extractDetail(exceptionResponse: unknown, fallback: string): string {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    const message = (exceptionResponse as Record<string, unknown> | null)?.message;
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    if (typeof message === 'string') {
      return message;
    }

    return fallback;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
}
