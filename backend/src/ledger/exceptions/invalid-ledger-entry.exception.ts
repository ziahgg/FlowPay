import { BadRequestException } from '@nestjs/common';

export class InvalidLedgerEntryException extends BadRequestException {
  constructor(message: string) {
    super(`Invalid ledger entry: ${message}`);
  }
}
