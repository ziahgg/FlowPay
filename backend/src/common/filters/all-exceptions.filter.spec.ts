import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let logger: { setContext: jest.Mock; error: jest.Mock };
  let filter: AllExceptionsFilter;
  let response: { status: jest.Mock; type: jest.Mock; json: jest.Mock };
  let host: ArgumentsHost;

  beforeEach(() => {
    logger = { setContext: jest.fn(), error: jest.fn() };
    filter = new AllExceptionsFilter(logger as unknown as PinoLogger);

    response = { status: jest.fn(), type: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);

    host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          url: '/api/v1/deposits',
          headers: { 'x-request-id': 'req-123' },
        }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('renders an HttpException as application/problem+json with a single-string detail', () => {
    filter.catch(new NotFoundException('Withdrawal request not found'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.json).toHaveBeenCalledWith({
      type: 'https://flowpay.dev/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Withdrawal request not found',
      instance: '/api/v1/deposits',
      requestId: 'req-123',
    });
  });

  it('joins class-validator array messages into one detail string', () => {
    filter.catch(new BadRequestException(['email must be an email', 'password too short']), host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        title: 'Bad Request',
        detail: 'email must be an email; password too short',
      }),
    );
  });

  it('never leaks the internal error message for an unexpected (non-HttpException) error', () => {
    filter.catch(new Error('connection string leaked here'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Internal Server Error',
        detail: 'Internal server error',
      }),
    );
  });

  it('logs the unhandled exception with the request id for correlation', () => {
    filter.catch(new NotFoundException('gone'), host);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-123', path: '/api/v1/deposits', statusCode: 404 }),
      'Unhandled exception',
    );
  });
});
