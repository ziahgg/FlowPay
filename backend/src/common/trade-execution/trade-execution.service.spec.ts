import { AccountKind } from '../../ledger/entities/account-kind.enum';
import { JournalEntryType } from '../../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../../ledger/entities/journal-line-direction.enum';
import { EnsureAccountInput } from '../../ledger/interfaces/ensure-account.interface';
import { LedgerService } from '../../ledger/ledger.service';
import { TradeExecutionService } from './trade-execution.service';

describe('TradeExecutionService', () => {
  let ledgerService: jest.Mocked<Pick<LedgerService, 'ensureAccount' | 'postEntry'>>;
  let service: TradeExecutionService;

  const userId = 'user-1';

  beforeEach(() => {
    ledgerService = {
      ensureAccount: jest
        .fn()
        .mockImplementation(({ ownerUserId, currencyCode, kind }: EnsureAccountInput) =>
          Promise.resolve({
            id: `${kind}-${currencyCode}-${ownerUserId ?? 'system'}`,
            ownerUserId,
            currencyCode,
            kind,
          }),
        ),
      postEntry: jest.fn().mockResolvedValue({
        entryId: 'entry-1',
        balances: {
          [`${AccountKind.USER_WALLET}-USD-${userId}`]: '900.00',
          [`${AccountKind.USER_WALLET}-BTC-${userId}`]: '0.01000000',
        },
      }),
    };

    service = new TradeExecutionService(ledgerService as unknown as LedgerService);
  });

  it('posts a 4-line entry: source/treasury for `from`, treasury/destination wallet for `to`', async () => {
    const result = await service.executeSwap({
      source: { ownerUserId: userId, currencyCode: 'USD', kind: AccountKind.USER_WALLET },
      fromAmount: '100.00',
      toUserId: userId,
      toCurrencyCode: 'BTC',
      toAmount: '0.01000000',
      entryType: JournalEntryType.TRADE,
      description: 'test swap',
      metadata: { note: 'x' },
    });

    expect(ledgerService.postEntry).toHaveBeenCalledWith(
      {
        type: JournalEntryType.TRADE,
        description: 'test swap',
        metadata: { note: 'x' },
        lines: [
          {
            accountId: `${AccountKind.USER_WALLET}-USD-${userId}`,
            direction: JournalLineDirection.DEBIT,
            amount: '100.00',
            currencyCode: 'USD',
          },
          {
            accountId: `${AccountKind.TREASURY}-USD-system`,
            direction: JournalLineDirection.CREDIT,
            amount: '100.00',
            currencyCode: 'USD',
          },
          {
            accountId: `${AccountKind.TREASURY}-BTC-system`,
            direction: JournalLineDirection.DEBIT,
            amount: '0.01000000',
            currencyCode: 'BTC',
          },
          {
            accountId: `${AccountKind.USER_WALLET}-BTC-${userId}`,
            direction: JournalLineDirection.CREDIT,
            amount: '0.01000000',
            currencyCode: 'BTC',
          },
        ],
      },
      undefined,
    );

    expect(result).toEqual({
      entryId: 'entry-1',
      sourceBalance: '900.00',
      toBalance: '0.01000000',
    });
  });

  it('uses a pooled (ownerUserId null) source account when the caller passes one, e.g. trade_hold', async () => {
    await service.executeSwap({
      source: { ownerUserId: null, currencyCode: 'USD', kind: AccountKind.TRADE_HOLD },
      fromAmount: '50.00',
      toUserId: userId,
      toCurrencyCode: 'BTC',
      toAmount: '0.005',
      entryType: JournalEntryType.TRADE,
    });

    expect(ledgerService.ensureAccount).toHaveBeenCalledWith({
      ownerUserId: null,
      currencyCode: 'USD',
      kind: AccountKind.TRADE_HOLD,
    });
  });

  it('passes the manager through to postEntry for atomic composition with a caller transaction', async () => {
    const manager = { fakeManager: true } as never;

    await service.executeSwap(
      {
        source: { ownerUserId: userId, currencyCode: 'USD', kind: AccountKind.USER_WALLET },
        fromAmount: '10.00',
        toUserId: userId,
        toCurrencyCode: 'BTC',
        toAmount: '0.001',
        entryType: JournalEntryType.TRADE,
      },
      manager,
    );

    expect(ledgerService.postEntry).toHaveBeenCalledWith(expect.anything(), manager);
  });
});
