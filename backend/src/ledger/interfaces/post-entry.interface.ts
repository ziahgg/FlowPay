import { JournalEntryType } from '../entities/journal-entry-type.enum';
import { JournalLineDirection } from '../entities/journal-line-direction.enum';

export interface PostEntryLineInput {
  accountId: string;
  direction: JournalLineDirection;
  amount: string;
  currencyCode: string;
}

export interface PostEntryInput {
  type: JournalEntryType;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  lines: PostEntryLineInput[];
}

export interface PostEntryResult {
  entryId: string;
  balances: Record<string, string>;
}
