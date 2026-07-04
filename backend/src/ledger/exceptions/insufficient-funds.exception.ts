import { UnprocessableEntityException } from '@nestjs/common';

export class InsufficientFundsException extends UnprocessableEntityException {
  constructor(accountId: string) {
    super(`Account ${accountId} does not have sufficient funds for this operation`);
  }
}
