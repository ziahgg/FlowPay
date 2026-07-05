import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DomainEventType } from '../common/outbox/domain-event-type.enum';
import { OutboxService } from '../common/outbox/outbox.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { CurrencyType } from '../ledger/entities/currency-type.enum';
import { LedgerService } from '../ledger/ledger.service';
import { UsersService } from '../users/users.service';
import { WithdrawalRequest } from './entities/withdrawal-request.entity';
import { WithdrawalRequestStatus } from './entities/withdrawal-request-status.enum';
import { WithdrawalsService } from './withdrawals.service';

describe('WithdrawalsService', () => {
  let service: WithdrawalsService;
  let ledgerService: jest.Mocked<
    Pick<LedgerService, 'getCurrency' | 'ensureAccount' | 'postEntry'>
  >;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let outboxService: jest.Mocked<Pick<OutboxService, 'append'>>;
  let dataSource: { transaction: jest.Mock };

  const createPendingRequest = (overrides: Partial<WithdrawalRequest> = {}): WithdrawalRequest => ({
    id: 'req-1',
    userId: 'user-1',
    currencyCode: 'USD',
    amount: '50.00000000',
    destination: 'acct-123',
    status: WithdrawalRequestStatus.PENDING,
    decidedBy: null,
    decidedAt: null,
    holdEntryId: 'hold-entry-1',
    settleEntryId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  const fakeManager = (findOneResult: WithdrawalRequest | null) => ({
    findOne: jest.fn().mockResolvedValue(findOneResult),
    getRepository: () => ({
      create: (data: Partial<WithdrawalRequest>) => data,
      save: jest.fn((data: Partial<WithdrawalRequest>) =>
        Promise.resolve({ id: 'req-new', ...data }),
      ),
    }),
    save: jest.fn((entity: WithdrawalRequest) => Promise.resolve(entity)),
  });

  beforeEach(async () => {
    ledgerService = {
      getCurrency: jest.fn(),
      ensureAccount: jest.fn(),
      postEntry: jest.fn(),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'jane@example.com' }),
    };
    outboxService = { append: jest.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalsService,
        { provide: LedgerService, useValue: ledgerService },
        { provide: UsersService, useValue: usersService },
        { provide: OutboxService, useValue: outboxService },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: getRepositoryToken(WithdrawalRequest), useValue: {} },
      ],
    }).compile();

    service = module.get<WithdrawalsService>(WithdrawalsService);
  });

  describe('requestWithdrawal', () => {
    it('posts a hold entry and creates a pending request', async () => {
      ledgerService.getCurrency.mockResolvedValue({
        code: 'USD',
        name: 'US Dollar',
        type: CurrencyType.FIAT,
        decimals: 2,
      });
      ledgerService.ensureAccount.mockImplementation(({ kind }) =>
        Promise.resolve({
          id: kind === AccountKind.USER_WALLET ? 'wallet-1' : 'pending-1',
          ownerUserId: kind === AccountKind.USER_WALLET ? 'user-1' : null,
          currencyCode: 'USD',
          kind,
        }),
      );
      ledgerService.postEntry.mockResolvedValue({
        entryId: 'hold-entry-1',
        balances: { 'wallet-1': '50.00000000', 'pending-1': '50.00000000' },
      });

      const manager = fakeManager(null);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      const result = await service.requestWithdrawal('user-1', 'USD', '50.00', 'acct-123');

      expect(ledgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [
            { accountId: 'wallet-1', direction: 'debit', amount: '50.00', currencyCode: 'USD' },
            { accountId: 'pending-1', direction: 'credit', amount: '50.00', currencyCode: 'USD' },
          ],
        }),
        manager,
      );
      expect(result).toMatchObject({
        currency: 'USD',
        amount: '50.00',
        destination: 'acct-123',
        status: WithdrawalRequestStatus.PENDING,
        holdEntryId: 'hold-entry-1',
      });
    });
  });

  describe('approve', () => {
    it('posts a settle entry and marks the request approved', async () => {
      const manager = fakeManager(createPendingRequest());
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));
      ledgerService.ensureAccount.mockImplementation(({ kind }) =>
        Promise.resolve({
          id: kind === AccountKind.TREASURY ? 'treasury-1' : 'pending-1',
          ownerUserId: null,
          currencyCode: 'USD',
          kind,
        }),
      );
      ledgerService.postEntry.mockResolvedValue({ entryId: 'settle-entry-1', balances: {} });

      const result = await service.approve('req-1', 'admin-1');

      expect(ledgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [
            {
              accountId: 'pending-1',
              direction: 'debit',
              amount: '50.00000000',
              currencyCode: 'USD',
            },
            {
              accountId: 'treasury-1',
              direction: 'credit',
              amount: '50.00000000',
              currencyCode: 'USD',
            },
          ],
        }),
        manager,
      );
      expect(result.status).toBe(WithdrawalRequestStatus.APPROVED);
      expect(result.settleEntryId).toBe('settle-entry-1');
      expect(outboxService.append).toHaveBeenCalledWith(
        {
          eventType: DomainEventType.WITHDRAWAL_APPROVED,
          aggregateId: 'settle-entry-1',
          payload: {
            recipientEmail: 'jane@example.com',
            currency: 'USD',
            amount: '50.00000000',
            destination: 'acct-123',
          },
        },
        manager,
      );
    });

    it('rejects with 404 when the request does not exist', async () => {
      const manager = fakeManager(null);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      await expect(service.approve('missing', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 409 when the request is not pending', async () => {
      const manager = fakeManager(
        createPendingRequest({ status: WithdrawalRequestStatus.APPROVED }),
      );
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      await expect(service.approve('req-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
      expect(ledgerService.postEntry).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('posts a release entry and marks the request rejected', async () => {
      const manager = fakeManager(createPendingRequest());
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));
      ledgerService.ensureAccount.mockImplementation(({ kind }) =>
        Promise.resolve({
          id: kind === AccountKind.USER_WALLET ? 'wallet-1' : 'pending-1',
          ownerUserId: kind === AccountKind.USER_WALLET ? 'user-1' : null,
          currencyCode: 'USD',
          kind,
        }),
      );
      ledgerService.postEntry.mockResolvedValue({ entryId: 'release-entry-1', balances: {} });

      const result = await service.reject('req-1', 'admin-1');

      expect(ledgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [
            {
              accountId: 'pending-1',
              direction: 'debit',
              amount: '50.00000000',
              currencyCode: 'USD',
            },
            {
              accountId: 'wallet-1',
              direction: 'credit',
              amount: '50.00000000',
              currencyCode: 'USD',
            },
          ],
        }),
        manager,
      );
      expect(result.status).toBe(WithdrawalRequestStatus.REJECTED);
      expect(result.settleEntryId).toBe('release-entry-1');
      expect(outboxService.append).toHaveBeenCalledWith(
        {
          eventType: DomainEventType.WITHDRAWAL_REJECTED,
          aggregateId: 'release-entry-1',
          payload: {
            recipientEmail: 'jane@example.com',
            currency: 'USD',
            amount: '50.00000000',
            destination: 'acct-123',
          },
        },
        manager,
      );
    });

    it('rejects with 409 when the request is already decided', async () => {
      const manager = fakeManager(
        createPendingRequest({ status: WithdrawalRequestStatus.REJECTED }),
      );
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      await expect(service.reject('req-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
      expect(ledgerService.postEntry).not.toHaveBeenCalled();
    });
  });
});
