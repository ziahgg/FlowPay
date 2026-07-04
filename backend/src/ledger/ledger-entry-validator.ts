import Decimal from 'decimal.js';
import { InvalidLedgerEntryException } from './exceptions/invalid-ledger-entry.exception';
import { JournalLineDirection } from './entities/journal-line-direction.enum';
import { PostEntryLineInput } from './interfaces/post-entry.interface';

const MAX_AMOUNT_DECIMALS = 8;

export function validateEntryLines(lines: PostEntryLineInput[]): void {
  if (lines.length < 2) {
    throw new InvalidLedgerEntryException('an entry must have at least 2 lines');
  }

  const totalsByCurrency = new Map<string, { debit: Decimal; credit: Decimal }>();

  for (const line of lines) {
    let amount: Decimal;

    try {
      amount = new Decimal(line.amount);
    } catch {
      throw new InvalidLedgerEntryException(`amount "${line.amount}" is not a valid decimal`);
    }

    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new InvalidLedgerEntryException(`amount "${line.amount}" must be greater than zero`);
    }

    if (amount.decimalPlaces() > MAX_AMOUNT_DECIMALS) {
      throw new InvalidLedgerEntryException(
        `amount "${line.amount}" supports at most ${MAX_AMOUNT_DECIMALS} decimal places`,
      );
    }

    const bucket = totalsByCurrency.get(line.currencyCode) ?? {
      debit: new Decimal(0),
      credit: new Decimal(0),
    };

    if (line.direction === JournalLineDirection.DEBIT) {
      bucket.debit = bucket.debit.plus(amount);
    } else {
      bucket.credit = bucket.credit.plus(amount);
    }

    totalsByCurrency.set(line.currencyCode, bucket);
  }

  for (const [currencyCode, { debit, credit }] of totalsByCurrency) {
    if (!debit.equals(credit)) {
      throw new InvalidLedgerEntryException(
        `entry does not balance for currency ${currencyCode}: debits ${debit.toFixed()} != credits ${credit.toFixed()}`,
      );
    }
  }
}
