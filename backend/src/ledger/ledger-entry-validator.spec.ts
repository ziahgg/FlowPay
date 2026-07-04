import { InvalidLedgerEntryException } from './exceptions/invalid-ledger-entry.exception';
import { JournalLineDirection } from './entities/journal-line-direction.enum';
import { validateEntryLines } from './ledger-entry-validator';

const line = (
  direction: JournalLineDirection,
  amount: string,
  currencyCode = 'USD',
  accountId = 'account-1',
) => ({ accountId, direction, amount, currencyCode });

describe('validateEntryLines', () => {
  it('accepts a balanced two-line entry', () => {
    expect(() =>
      validateEntryLines([
        line(JournalLineDirection.DEBIT, '10.00', 'USD', 'a'),
        line(JournalLineDirection.CREDIT, '10.00', 'USD', 'b'),
      ]),
    ).not.toThrow();
  });

  it('accepts a balanced multi-currency entry', () => {
    expect(() =>
      validateEntryLines([
        line(JournalLineDirection.DEBIT, '10.00', 'USD', 'a'),
        line(JournalLineDirection.CREDIT, '10.00', 'USD', 'b'),
        line(JournalLineDirection.DEBIT, '0.5', 'BTC', 'c'),
        line(JournalLineDirection.CREDIT, '0.5', 'BTC', 'd'),
      ]),
    ).not.toThrow();
  });

  it('rejects a single-line entry', () => {
    expect(() => validateEntryLines([line(JournalLineDirection.DEBIT, '10.00')])).toThrow(
      InvalidLedgerEntryException,
    );
  });

  it('rejects an empty entry', () => {
    expect(() => validateEntryLines([])).toThrow(InvalidLedgerEntryException);
  });

  it('rejects a zero amount', () => {
    expect(() =>
      validateEntryLines([
        line(JournalLineDirection.DEBIT, '0', 'USD', 'a'),
        line(JournalLineDirection.CREDIT, '0', 'USD', 'b'),
      ]),
    ).toThrow(InvalidLedgerEntryException);
  });

  it('rejects a negative amount', () => {
    expect(() =>
      validateEntryLines([
        line(JournalLineDirection.DEBIT, '-5', 'USD', 'a'),
        line(JournalLineDirection.CREDIT, '5', 'USD', 'b'),
      ]),
    ).toThrow(InvalidLedgerEntryException);
  });

  it('rejects an amount with more than 8 decimal places', () => {
    expect(() =>
      validateEntryLines([
        line(JournalLineDirection.DEBIT, '1.123456789', 'BTC', 'a'),
        line(JournalLineDirection.CREDIT, '1.123456789', 'BTC', 'b'),
      ]),
    ).toThrow(InvalidLedgerEntryException);
  });

  it('rejects a non-numeric amount', () => {
    expect(() =>
      validateEntryLines([
        line(JournalLineDirection.DEBIT, 'not-a-number', 'USD', 'a'),
        line(JournalLineDirection.CREDIT, '5', 'USD', 'b'),
      ]),
    ).toThrow(InvalidLedgerEntryException);
  });

  it('rejects an unbalanced entry within a single currency', () => {
    expect(() =>
      validateEntryLines([
        line(JournalLineDirection.DEBIT, '10.00', 'USD', 'a'),
        line(JournalLineDirection.CREDIT, '9.99', 'USD', 'b'),
      ]),
    ).toThrow(InvalidLedgerEntryException);
  });

  it('rejects a mixed-currency entry where one currency balances but another does not', () => {
    expect(() =>
      validateEntryLines([
        line(JournalLineDirection.DEBIT, '10.00', 'USD', 'a'),
        line(JournalLineDirection.CREDIT, '10.00', 'USD', 'b'),
        line(JournalLineDirection.DEBIT, '1.0', 'EUR', 'c'),
      ]),
    ).toThrow(InvalidLedgerEntryException);
  });
});
