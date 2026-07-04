import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { EnvConfig } from '../common/config/env.schema';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { LedgerService } from '../ledger/ledger.service';
import { DepositResponseDto } from './dto/deposit-response.dto';

@Injectable()
export class DepositsService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async deposit(userId: string, currencyCode: string, amount: string): Promise<DepositResponseDto> {
    const currency = await this.ledgerService.getCurrency(currencyCode);

    const maxAmount = this.configService.get('DEPOSIT_MAX_AMOUNT', { infer: true });
    if (new Decimal(amount).greaterThan(maxAmount)) {
      throw new BadRequestException(
        `Deposit amount exceeds the maximum allowed of ${maxAmount} per deposit`,
      );
    }

    const [wallet, treasury] = await Promise.all([
      this.ledgerService.ensureAccount({
        ownerUserId: userId,
        currencyCode: currency.code,
        kind: AccountKind.USER_WALLET,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: null,
        currencyCode: currency.code,
        kind: AccountKind.TREASURY,
      }),
    ]);

    const result = await this.ledgerService.postEntry({
      type: JournalEntryType.DEPOSIT,
      description: `Simulated deposit of ${amount} ${currency.code}`,
      metadata: { userId, currencyCode: currency.code },
      lines: [
        {
          accountId: treasury.id,
          direction: JournalLineDirection.DEBIT,
          amount,
          currencyCode: currency.code,
        },
        {
          accountId: wallet.id,
          direction: JournalLineDirection.CREDIT,
          amount,
          currencyCode: currency.code,
        },
      ],
    });

    return { currency: currency.code, amount, balance: result.balances[wallet.id] };
  }
}
