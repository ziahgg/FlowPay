import { ConflictException } from '@nestjs/common';

export class IdempotencyConflictException extends ConflictException {
  constructor() {
    super('A request with this idempotency key is already being processed');
  }
}
