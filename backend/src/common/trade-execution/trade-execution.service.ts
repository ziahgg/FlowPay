import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccountKind } from '../../ledger/entities/account-kind.enum';
import { JournalLineDirection } from '../../ledger/entities/journal-line-direction.enum';
import { PostEntryLineInput } from '../../ledger/interfaces/post-entry.interface';
import { LedgerService } from '../../ledger/ledger.service';
import { ExecuteSwapInput, ExecuteSwapResult } from './interfaces/execute-swap.interface';

/**
 * Shared "atomic 2-currency swap" primitive, extracted from FX conversion so trading doesn't
 * duplicate it. Every use case here has the same 4-line shape: debit the source account for
 * `fromAmount`, credit treasury[from-currency] the same; debit treasury[to-currency] for
 * `toAmount`, credit the destination user's wallet the same. Each currency balances
 * independently, exactly as LedgerService.postEntry requires.
 *
 * The only thing that varies across callers is the *source* account: FX conversion and market
 * orders debit the user's own wallet; a filled limit order debits the pooled `trade_hold[currency]`
 * account the funds were already moved into when the order was placed (see trading/orders.service).
 */
@Injectable()
export class TradeExecutionService {
  constructor(private readonly ledgerService: LedgerService) {}

  async executeSwap(input: ExecuteSwapInput, manager?: EntityManager): Promise<ExecuteSwapResult> {
    const [sourceAccount, treasurySource, treasuryDest, destWallet] = await Promise.all([
      this.ledgerService.ensureAccount({
        ownerUserId: input.source.ownerUserId,
        currencyCode: input.source.currencyCode,
        kind: input.source.kind,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: null,
        currencyCode: input.source.currencyCode,
        kind: AccountKind.TREASURY,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: null,
        currencyCode: input.toCurrencyCode,
        kind: AccountKind.TREASURY,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: input.toUserId,
        currencyCode: input.toCurrencyCode,
        kind: AccountKind.USER_WALLET,
      }),
    ]);

    const lines: PostEntryLineInput[] = [
      {
        accountId: sourceAccount.id,
        direction: JournalLineDirection.DEBIT,
        amount: input.fromAmount,
        currencyCode: input.source.currencyCode,
      },
      {
        accountId: treasurySource.id,
        direction: JournalLineDirection.CREDIT,
        amount: input.fromAmount,
        currencyCode: input.source.currencyCode,
      },
      {
        accountId: treasuryDest.id,
        direction: JournalLineDirection.DEBIT,
        amount: input.toAmount,
        currencyCode: input.toCurrencyCode,
      },
      {
        accountId: destWallet.id,
        direction: JournalLineDirection.CREDIT,
        amount: input.toAmount,
        currencyCode: input.toCurrencyCode,
      },
    ];

    const result = await this.ledgerService.postEntry(
      {
        type: input.entryType,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
        lines,
      },
      manager,
    );

    return {
      entryId: result.entryId,
      sourceBalance: result.balances[sourceAccount.id],
      toBalance: result.balances[destWallet.id],
    };
  }
}
