import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { EnvConfig } from '../common/config/env.schema';
import { DomainEventType } from '../common/outbox/domain-event-type.enum';
import { OutboxService } from '../common/outbox/outbox.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { LedgerService } from '../ledger/ledger.service';
import { DepositResponseDto } from './dto/deposit-response.dto';

@Injectable()
export class DepositsService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService<EnvConfig, true>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async deposit(
    userId: string,
    userEmail: string,
    currencyCode: string,
    amount: string,
  ): Promise<DepositResponseDto> {
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

    const result = await this.dataSource.transaction(async (manager) => {
      const postResult = await this.ledgerService.postEntry(
        {
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
        },
        manager,
      );

      await this.outboxService.append(
        {
          eventType: DomainEventType.DEPOSIT_COMPLETED,
          aggregateId: postResult.entryId,
          payload: { recipientEmail: userEmail, currency: currency.code, amount },
        },
        manager,
      );

      return postResult;
    });

    return { currency: currency.code, amount, balance: result.balances[wallet.id] };
  }
}
