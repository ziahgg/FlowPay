import { AccountKind } from '../../../ledger/entities/account-kind.enum';
import { JournalEntryType } from '../../../ledger/entities/journal-entry-type.enum';

/**
 * The account debited for `fromAmount`. Usually a user's own wallet (FX conversion, a market
 * order), but for a filled limit order it's the pooled `trade_hold[currency]` system account the
 * funds were already moved into at hold time -- see TradeExecutionService.
 */
export interface SwapSourceAccount {
  ownerUserId: string | null;
  currencyCode: string;
  kind: AccountKind;
}

export interface ExecuteSwapInput {
  source: SwapSourceAccount;
  fromAmount: string;
  toUserId: string;
  toCurrencyCode: string;
  toAmount: string;
  entryType: JournalEntryType;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ExecuteSwapResult {
  entryId: string;
  sourceBalance: string;
  toBalance: string;
}
