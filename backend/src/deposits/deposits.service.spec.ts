import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DomainEventType } from '../common/outbox/domain-event-type.enum';
import { OutboxService } from '../common/outbox/outbox.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { CurrencyType } from '../ledger/entities/currency-type.enum';
import { LedgerService } from '../ledger/ledger.service';
import { DepositsService } from './deposits.service';

describe('DepositsService', () => {
  let service: DepositsService;
  let ledgerService: jest.Mocked<
    Pick<LedgerService, 'getCurrency' | 'ensureAccount' | 'postEntry'>
  >;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let outboxService: jest.Mocked<Pick<OutboxService, 'append'>>;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    ledgerService = {
      getCurrency: jest.fn(),
      ensureAccount: jest.fn(),
      postEntry: jest.fn(),
    };
    configService = { get: jest.fn().mockReturnValue('50000') };
    outboxService = { append: jest.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: jest.fn((cb: (manager: unknown) => unknown) => cb({})) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositsService,
        { provide: LedgerService, useValue: ledgerService },
        { provide: OutboxService, useValue: outboxService },
        { provide: ConfigService, useValue: configService },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<DepositsService>(DepositsService);
  });

  it('posts a deposit entry crediting the wallet and debiting treasury', async () => {
    ledgerService.getCurrency.mockResolvedValue({
      code: 'USD',
      name: 'US Dollar',
      type: CurrencyType.FIAT,
      decimals: 2,
    });
    ledgerService.ensureAccount.mockImplementation(({ kind }) =>
      Promise.resolve({
        id: kind === AccountKind.TREASURY ? 'treasury-1' : 'wallet-1',
        ownerUserId: kind === AccountKind.TREASURY ? null : 'user-1',
        currencyCode: 'USD',
        kind,
      }),
    );
    ledgerService.postEntry.mockResolvedValue({
      entryId: 'entry-1',
      balances: { 'wallet-1': '100.00000000', 'treasury-1': '-100.00000000' },
    });

    const result = await service.deposit('user-1', 'jane@example.com', 'USD', '100.00');

    expect(ledgerService.postEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          { accountId: 'treasury-1', direction: 'debit', amount: '100.00', currencyCode: 'USD' },
          { accountId: 'wallet-1', direction: 'credit', amount: '100.00', currencyCode: 'USD' },
        ],
      }),
      expect.anything(),
    );
    expect(result).toEqual({ currency: 'USD', amount: '100.00', balance: '100.00000000' });
    expect(outboxService.append).toHaveBeenCalledWith(
      {
        eventType: DomainEventType.DEPOSIT_COMPLETED,
        aggregateId: 'entry-1',
        payload: { recipientEmail: 'jane@example.com', currency: 'USD', amount: '100.00' },
      },
      expect.anything(),
    );
  });

  it('rejects a deposit above the configured maximum before touching the ledger', async () => {
    ledgerService.getCurrency.mockResolvedValue({
      code: 'USD',
      name: 'US Dollar',
      type: CurrencyType.FIAT,
      decimals: 2,
    });
    configService.get.mockReturnValue('100');

    await expect(
      service.deposit('user-1', 'jane@example.com', 'USD', '100.01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledgerService.ensureAccount).not.toHaveBeenCalled();
    expect(ledgerService.postEntry).not.toHaveBeenCalled();
  });
});
