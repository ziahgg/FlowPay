export interface AccountBalance {
  currency: string;
  balance: string;
  decimals: number;
}

export type JournalEntryType =
  | 'deposit'
  | 'withdrawal_hold'
  | 'withdrawal_settle'
  | 'withdrawal_release'
  | 'transfer'
  | 'fx_convert'
  | 'trade';

export type JournalLineDirection = 'debit' | 'credit';

export interface TransactionLine {
  type: JournalEntryType;
  direction: JournalLineDirection;
  amount: string;
  description: string | null;
  createdAt: string;
}
