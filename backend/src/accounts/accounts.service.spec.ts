import { Test, TestingModule } from '@nestjs/testing';
import { AccountsService } from './accounts.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { CurrencyType } from '../ledger/entities/currency-type.enum';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { LedgerService } from '../ledger/ledger.service';

describe('AccountsService', () => {
  let service: AccountsService;
  let ledgerService: jest.Mocked<
    Pick<
      LedgerService,
      'listCurrencies' | 'ensureAccount' | 'getBalance' | 'getCurrency' | 'listJournalLines'
    >
  >;

  beforeEach(async () => {
    ledgerService = {
      listCurrencies: jest.fn(),
      ensureAccount: jest.fn(),
      getBalance: jest.fn(),
      getCurrency: jest.fn(),
      listJournalLines: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AccountsService, { provide: LedgerService, useValue: ledgerService }],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
  });

  it('lazily ensures a wallet per currency and returns each balance', async () => {
    ledgerService.listCurrencies.mockResolvedValue([
      { code: 'USD', name: 'US Dollar', type: CurrencyType.FIAT, decimals: 2 },
      { code: 'BTC', name: 'Bitcoin', type: CurrencyType.CRYPTO, decimals: 8 },
    ]);
    ledgerService.ensureAccount.mockImplementation(({ currencyCode }) =>
      Promise.resolve({
        id: `wallet-${currencyCode}`,
        ownerUserId: 'user-1',
        currencyCode,
        kind: AccountKind.USER_WALLET,
      }),
    );
    ledgerService.getBalance.mockImplementation((accountId) =>
      Promise.resolve({ accountId, currencyCode: 'USD', balance: '10.00000000' }),
    );

    const result = await service.getBalances('user-1');

    expect(ledgerService.ensureAccount).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      currencyCode: 'USD',
      kind: AccountKind.USER_WALLET,
    });
    expect(result).toEqual([
      { currency: 'USD', balance: '10.00000000', decimals: 2 },
      { currency: 'BTC', balance: '10.00000000', decimals: 8 },
    ]);
  });

  it('maps journal lines to transaction DTOs with pagination metadata', async () => {
    ledgerService.getCurrency.mockResolvedValue({
      code: 'USD',
      name: 'US Dollar',
      type: CurrencyType.FIAT,
      decimals: 2,
    });
    ledgerService.ensureAccount.mockResolvedValue({
      id: 'wallet-1',
      ownerUserId: 'user-1',
      currencyCode: 'USD',
      kind: AccountKind.USER_WALLET,
    });
    ledgerService.listJournalLines.mockResolvedValue({
      items: [
        {
          id: 'line-1',
          entryId: 'entry-1',
          entry: {
            id: 'entry-1',
            type: JournalEntryType.DEPOSIT,
            description: 'Simulated deposit',
            metadata: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          accountId: 'wallet-1',
          account: undefined as never,
          direction: JournalLineDirection.CREDIT,
          amount: '10.00000000',
          currencyCode: 'USD',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      total: 1,
    });

    const result = await service.getTransactions('user-1', 'usd', { page: 1, limit: 20 });

    expect(ledgerService.getCurrency).toHaveBeenCalledWith('usd');
    expect(result).toEqual({
      data: [
        {
          type: JournalEntryType.DEPOSIT,
          direction: JournalLineDirection.CREDIT,
          amount: '10.00000000',
          description: 'Simulated deposit',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    });
  });
});
