import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AccountKind } from './entities/account-kind.enum';
import { Currency } from './entities/currency.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryType } from './entities/journal-entry-type.enum';
import { JournalLine } from './entities/journal-line.entity';
import { JournalLineDirection } from './entities/journal-line-direction.enum';
import { InsufficientFundsException } from './exceptions/insufficient-funds.exception';
import { InvalidLedgerEntryException } from './exceptions/invalid-ledger-entry.exception';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  let service: LedgerService;
  let managerQuery: jest.Mock;
  let dataSource: { transaction: jest.Mock; query: jest.Mock };

  const fakeManager = () => ({
    query: managerQuery,
    getRepository: (entity: unknown) => {
      if (entity === JournalEntry) {
        return {
          create: (data: Partial<JournalEntry>) => data,
          save: jest.fn((data: Partial<JournalEntry>) =>
            Promise.resolve({ id: 'entry-1', ...data }),
          ),
        };
      }
      if (entity === JournalLine) {
        return {
          create: (data: Partial<JournalLine>) => data,
          save: jest.fn((data: Partial<JournalLine>[]) => Promise.resolve(data)),
        };
      }
      throw new Error(`Unexpected entity ${String(entity)}`);
    },
    findOne: jest.fn(),
  });

  beforeEach(async () => {
    managerQuery = jest.fn();
    dataSource = {
      transaction: jest.fn((cb: (manager: unknown) => unknown) => cb(fakeManager())),
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: getRepositoryToken(Currency), useValue: {} },
        { provide: getRepositoryToken(JournalLine), useValue: {} },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });

  describe('postEntry', () => {
    it('rejects a malformed entry before touching the database', async () => {
      await expect(
        service.postEntry({
          type: JournalEntryType.TRANSFER,
          lines: [
            {
              accountId: 'a',
              direction: JournalLineDirection.DEBIT,
              amount: '10',
              currencyCode: 'USD',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(InvalidLedgerEntryException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects when a user-owned account would go negative', async () => {
      managerQuery.mockResolvedValueOnce([
        {
          accountId: 'wallet-1',
          balance: '5.00000000',
          ownerUserId: 'user-1',
          currencyCode: 'USD',
        },
        { accountId: 'treasury-1', balance: '0.00000000', ownerUserId: null, currencyCode: 'USD' },
      ]);

      await expect(
        service.postEntry({
          type: JournalEntryType.WITHDRAWAL_HOLD,
          lines: [
            {
              accountId: 'wallet-1',
              direction: JournalLineDirection.DEBIT,
              amount: '10',
              currencyCode: 'USD',
            },
            {
              accountId: 'treasury-1',
              direction: JournalLineDirection.CREDIT,
              amount: '10',
              currencyCode: 'USD',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(InsufficientFundsException);
    });

    it('allows a system account to go negative', async () => {
      managerQuery.mockResolvedValueOnce([
        {
          accountId: 'wallet-1',
          balance: '0.00000000',
          ownerUserId: 'user-1',
          currencyCode: 'USD',
        },
        { accountId: 'treasury-1', balance: '0.00000000', ownerUserId: null, currencyCode: 'USD' },
      ]);
      managerQuery.mockResolvedValue(undefined);

      const result = await service.postEntry({
        type: JournalEntryType.DEPOSIT,
        lines: [
          {
            accountId: 'treasury-1',
            direction: JournalLineDirection.DEBIT,
            amount: '10',
            currencyCode: 'USD',
          },
          {
            accountId: 'wallet-1',
            direction: JournalLineDirection.CREDIT,
            amount: '10',
            currencyCode: 'USD',
          },
        ],
      });

      expect(result.balances['wallet-1']).toBe('10.00000000');
      expect(result.balances['treasury-1']).toBe('-10.00000000');
    });

    it('rejects when a line currency does not match the account currency', async () => {
      managerQuery.mockResolvedValueOnce([
        {
          accountId: 'wallet-1',
          balance: '0.00000000',
          ownerUserId: 'user-1',
          currencyCode: 'EUR',
        },
        { accountId: 'treasury-1', balance: '0.00000000', ownerUserId: null, currencyCode: 'USD' },
      ]);

      await expect(
        service.postEntry({
          type: JournalEntryType.DEPOSIT,
          lines: [
            {
              accountId: 'treasury-1',
              direction: JournalLineDirection.DEBIT,
              amount: '10',
              currencyCode: 'USD',
            },
            {
              accountId: 'wallet-1',
              direction: JournalLineDirection.CREDIT,
              amount: '10',
              currencyCode: 'USD',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(InvalidLedgerEntryException);
    });
  });

  describe('ensureAccount', () => {
    it('returns the existing account without inserting when one is already present', async () => {
      const manager = fakeManager();
      const existing = {
        id: 'acc-1',
        ownerUserId: 'user-1',
        currencyCode: 'USD',
        kind: AccountKind.USER_WALLET,
      };
      manager.findOne.mockResolvedValue(existing);
      dataSource.transaction.mockImplementationOnce((cb: (m: unknown) => unknown) => cb(manager));

      const result = await service.ensureAccount({
        ownerUserId: 'user-1',
        currencyCode: 'USD',
        kind: AccountKind.USER_WALLET,
      });

      expect(result).toBe(existing);
      expect(managerQuery).not.toHaveBeenCalled();
    });
  });
});
