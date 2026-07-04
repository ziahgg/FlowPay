import { UnprocessableEntityException } from '@nestjs/common';

export class IdempotencyPayloadMismatchException extends UnprocessableEntityException {
  constructor() {
    super('This idempotency key was already used with a different request payload');
  }
}
