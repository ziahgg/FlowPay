import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { RunIdempotentParams } from '../common/idempotency/interfaces/run-idempotent.interface';
import { DomainEventType } from '../common/outbox/domain-event-type.enum';
import { OutboxService } from '../common/outbox/outbox.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { CurrencyType } from '../ledger/entities/currency-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { EnsureAccountInput } from '../ledger/interfaces/ensure-account.interface';
import { LedgerService } from '../ledger/ledger.service';
import { UserRole } from '../users/entities/user-role.enum';
import { UsersService } from '../users/users.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransfersService } from './transfers.service';

describe('TransfersService', () => {
  let service: TransfersService;
  let ledgerService: jest.Mocked<
    Pick<LedgerService, 'getCurrency' | 'ensureAccount' | 'postEntry'>
  >;
  let usersService: jest.Mocked<Pick<UsersService, 'findById' | 'findByEmail'>>;
  let idempotencyService: { run: jest.Mock };
  let configService: { get: jest.Mock };
  let outboxService: jest.Mocked<Pick<OutboxService, 'append'>>;
  let dataSource: { transaction: jest.Mock };

  const sender = {
    id: 'sender-1',
    email: 'sender@example.com',
    role: UserRole.USER,
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordHash: 'x',
  };
  const recipient = {
    id: 'recipient-1',
    email: 'recipient@example.com',
    role: UserRole.USER,
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordHash: 'x',
  };

  const dto: CreateTransferDto = {
    recipientEmail: recipient.email,
    currency: 'USD',
    amount: '10.00',
  };

  beforeEach(async () => {
    ledgerService = {
      getCurrency: jest.fn().mockResolvedValue({
        code: 'USD',
        name: 'US Dollar',
        type: CurrencyType.FIAT,
        decimals: 2,
      }),
      ensureAccount: jest.fn().mockImplementation(({ ownerUserId, kind }: EnsureAccountInput) =>
        Promise.resolve({
          id: `${kind}-${ownerUserId ?? 'system'}`,
          ownerUserId,
          currencyCode: 'USD',
          kind,
        }),
      ),
      postEntry: jest.fn().mockResolvedValue({
        entryId: 'entry-1',
        balances: { [`${AccountKind.USER_WALLET}-${sender.id}`]: '90.00000000' },
      }),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue(sender),
      findByEmail: jest.fn().mockResolvedValue(recipient),
    };
    idempotencyService = {
      run: jest.fn(async (params: RunIdempotentParams<unknown>) => {
        const { body } = await params.handler();
        return { body, statusCode: params.successStatus, replayed: false };
      }),
    };
    configService = { get: jest.fn().mockReturnValue('0') };
    outboxService = { append: jest.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: jest.fn((cb: (manager: unknown) => unknown) => cb({})) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: LedgerService, useValue: ledgerService },
        { provide: UsersService, useValue: usersService },
        { provide: IdempotencyService, useValue: idempotencyService },
        { provide: OutboxService, useValue: outboxService },
        { provide: ConfigService, useValue: configService },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
  });

  it('posts a two-line transfer entry when no fee is configured', async () => {
    const result = await service.create(sender.id, 'idem-key-1', dto);

    expect(idempotencyService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: sender.id,
        key: 'idem-key-1',
        endpoint: 'POST /api/v1/transfers',
        requestPayload: dto,
        successStatus: 201,
      }),
    );

    const postedEntry = ledgerService.postEntry.mock.calls[0][0];
    expect(postedEntry.lines).toEqual([
      {
        accountId: `${AccountKind.USER_WALLET}-${sender.id}`,
        direction: JournalLineDirection.DEBIT,
        amount: '10.00000000',
        currencyCode: 'USD',
      },
      {
        accountId: `${AccountKind.USER_WALLET}-${recipient.id}`,
        direction: JournalLineDirection.CREDIT,
        amount: '10.00',
        currencyCode: 'USD',
      },
    ]);
    expect(ledgerService.ensureAccount).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: AccountKind.FEES }),
    );

    expect(result.body).toEqual({
      entryId: 'entry-1',
      currency: 'USD',
      amount: '10.00',
      balance: '90.00000000',
    });

    expect(outboxService.append).toHaveBeenCalledWith(
      {
        eventType: DomainEventType.TRANSFER_COMPLETED,
        aggregateId: 'entry-1',
        payload: {
          recipientEmail: recipient.email,
          senderEmail: sender.email,
          currency: 'USD',
          amount: '10.00',
          note: null,
        },
      },
      expect.anything(),
    );
  });

  it('adds a third fee line and debits the sender for amount + fee when a flat fee is configured', async () => {
    configService.get.mockReturnValue('2.50');

    await service.create(sender.id, 'idem-key-2', dto);

    const postedEntry = ledgerService.postEntry.mock.calls[0][0];
    expect(postedEntry.lines).toEqual([
      {
        accountId: `${AccountKind.USER_WALLET}-${sender.id}`,
        direction: JournalLineDirection.DEBIT,
        amount: '12.50000000',
        currencyCode: 'USD',
      },
      {
        accountId: `${AccountKind.USER_WALLET}-${recipient.id}`,
        direction: JournalLineDirection.CREDIT,
        amount: '10.00',
        currencyCode: 'USD',
      },
      {
        accountId: `${AccountKind.FEES}-system`,
        direction: JournalLineDirection.CREDIT,
        amount: '2.50000000',
        currencyCode: 'USD',
      },
    ]);
  });

  it('rejects a transfer to yourself before posting anything', async () => {
    usersService.findByEmail.mockResolvedValue(sender);

    await expect(service.create(sender.id, 'idem-key-3', dto)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(ledgerService.postEntry).not.toHaveBeenCalled();
  });

  it('rejects an unknown recipient before posting anything', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(service.create(sender.id, 'idem-key-4', dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ledgerService.postEntry).not.toHaveBeenCalled();
  });
});
