import { randomUUID } from 'crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { AccountKind } from '../src/ledger/entities/account-kind.enum';
import { Currency } from '../src/ledger/entities/currency.entity';
import { CurrencyType } from '../src/ledger/entities/currency-type.enum';
import { JournalEntryType } from '../src/ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../src/ledger/entities/journal-line-direction.enum';
import { InsufficientFundsException } from '../src/ledger/exceptions/insufficient-funds.exception';
import { InvalidLedgerEntryException } from '../src/ledger/exceptions/invalid-ledger-entry.exception';
import { LedgerModule } from '../src/ledger/ledger.module';
import { LedgerService } from '../src/ledger/ledger.service';
import { CreateLedgerCore1751600000000 } from '../src/migrations/1751600000000-CreateLedgerCore';
import { CreateUsersTable1751500000000 } from '../src/migrations/1751500000000-CreateUsersTable';

jest.setTimeout(120_000);

describe('Ledger (integration, real Postgres via Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let ledgerService: LedgerService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start();

    const connectionOptions = {
      host: container.getHost(),
      port: container.getMappedPort(5432),
      username: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
    };

    const migrationDataSource = new DataSource({
      type: 'postgres',
      ...connectionOptions,
      migrations: [CreateUsersTable1751500000000, CreateLedgerCore1751600000000],
    });
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    await migrationDataSource.destroy();

    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          ...connectionOptions,
          autoLoadEntities: true,
          synchronize: false,
        }),
        LedgerModule,
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    ledgerService = moduleRef.get(LedgerService);

    await dataSource.getRepository(Currency).save([
      { code: 'USD', name: 'US Dollar', type: CurrencyType.FIAT, decimals: 2 },
      { code: 'BTC', name: 'Bitcoin', type: CurrencyType.CRYPTO, decimals: 8 },
    ]);
  });

  afterAll(async () => {
    await moduleRef.close();
    await container.stop();
  });

  async function createTestUser(): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'x', 'user')`,
      [id, `${id}@example.com`],
    );
    return id;
  }

  async function sumJournalLines(accountId: string): Promise<Decimal> {
    const rows: { direction: JournalLineDirection; amount: string }[] = await dataSource.query(
      `SELECT direction, amount FROM journal_lines WHERE account_id = $1`,
      [accountId],
    );
    return rows.reduce((total, row) => {
      const sign = row.direction === JournalLineDirection.CREDIT ? 1 : -1;
      return total.plus(new Decimal(row.amount).times(sign));
    }, new Decimal(0));
  }

  async function expectBalanceMatchesJournal(accountId: string): Promise<void> {
    const { balance } = await ledgerService.getBalance(accountId);
    const sum = await sumJournalLines(accountId);
    expect(new Decimal(balance).equals(sum)).toBe(true);
  }

  it('posts a balanced entry and derives the balance from the journal', async () => {
    const treasury = await ledgerService.ensureAccount({
      ownerUserId: null,
      currencyCode: 'USD',
      kind: AccountKind.TREASURY,
    });
    const wallet = await ledgerService.ensureAccount({
      ownerUserId: await createTestUser(),
      currencyCode: 'USD',
      kind: AccountKind.USER_WALLET,
    });

    await ledgerService.postEntry({
      type: JournalEntryType.DEPOSIT,
      description: 'test deposit',
      lines: [
        {
          accountId: treasury.id,
          direction: JournalLineDirection.DEBIT,
          amount: '100.00',
          currencyCode: 'USD',
        },
        {
          accountId: wallet.id,
          direction: JournalLineDirection.CREDIT,
          amount: '100.00',
          currencyCode: 'USD',
        },
      ],
    });

    const { balance } = await ledgerService.getBalance(wallet.id);
    expect(balance).toBe('100.00000000');
    await expectBalanceMatchesJournal(wallet.id);
    await expectBalanceMatchesJournal(treasury.id);
  });

  it('rejects an overdraft on a user account and leaves balances unchanged', async () => {
    const treasury = await ledgerService.ensureAccount({
      ownerUserId: null,
      currencyCode: 'USD',
      kind: AccountKind.TREASURY,
    });
    const wallet = await ledgerService.ensureAccount({
      ownerUserId: await createTestUser(),
      currencyCode: 'USD',
      kind: AccountKind.USER_WALLET,
    });

    const before = await ledgerService.getBalance(wallet.id);

    await expect(
      ledgerService.postEntry({
        type: JournalEntryType.WITHDRAWAL_HOLD,
        lines: [
          {
            accountId: wallet.id,
            direction: JournalLineDirection.DEBIT,
            amount: '50.00',
            currencyCode: 'USD',
          },
          {
            accountId: treasury.id,
            direction: JournalLineDirection.CREDIT,
            amount: '50.00',
            currencyCode: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsException);

    const after = await ledgerService.getBalance(wallet.id);
    expect(after.balance).toBe(before.balance);
    await expectBalanceMatchesJournal(wallet.id);
  });

  it('allows the treasury account to go negative', async () => {
    const treasury = await ledgerService.ensureAccount({
      ownerUserId: null,
      currencyCode: 'BTC',
      kind: AccountKind.TREASURY,
    });
    const wallet = await ledgerService.ensureAccount({
      ownerUserId: await createTestUser(),
      currencyCode: 'BTC',
      kind: AccountKind.USER_WALLET,
    });

    await ledgerService.postEntry({
      type: JournalEntryType.DEPOSIT,
      lines: [
        {
          accountId: treasury.id,
          direction: JournalLineDirection.DEBIT,
          amount: '1.5',
          currencyCode: 'BTC',
        },
        {
          accountId: wallet.id,
          direction: JournalLineDirection.CREDIT,
          amount: '1.5',
          currencyCode: 'BTC',
        },
      ],
    });

    const { balance } = await ledgerService.getBalance(treasury.id);
    expect(balance).toBe('-1.50000000');
    await expectBalanceMatchesJournal(treasury.id);
  });

  it('rejects a multi-currency entry where one currency does not balance, with no partial writes', async () => {
    const treasuryUsd = await ledgerService.ensureAccount({
      ownerUserId: null,
      currencyCode: 'USD',
      kind: AccountKind.TREASURY,
    });
    const walletUsd = await ledgerService.ensureAccount({
      ownerUserId: await createTestUser(),
      currencyCode: 'USD',
      kind: AccountKind.USER_WALLET,
    });
    const treasuryBtc = await ledgerService.ensureAccount({
      ownerUserId: null,
      currencyCode: 'BTC',
      kind: AccountKind.TREASURY,
    });

    const beforeUsd = await ledgerService.getBalance(walletUsd.id);
    const beforeBtc = await ledgerService.getBalance(treasuryBtc.id);

    await expect(
      ledgerService.postEntry({
        type: JournalEntryType.FX_CONVERT,
        lines: [
          {
            accountId: treasuryUsd.id,
            direction: JournalLineDirection.DEBIT,
            amount: '10.00',
            currencyCode: 'USD',
          },
          {
            accountId: walletUsd.id,
            direction: JournalLineDirection.CREDIT,
            amount: '10.00',
            currencyCode: 'USD',
          },
          {
            accountId: treasuryBtc.id,
            direction: JournalLineDirection.DEBIT,
            amount: '0.001',
            currencyCode: 'BTC',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidLedgerEntryException);

    expect((await ledgerService.getBalance(walletUsd.id)).balance).toBe(beforeUsd.balance);
    expect((await ledgerService.getBalance(treasuryBtc.id)).balance).toBe(beforeBtc.balance);
  });

  it('concurrency: exactly the affordable subset of parallel debits succeeds, balance never negative, cache stays consistent', async () => {
    const treasury = await ledgerService.ensureAccount({
      ownerUserId: null,
      currencyCode: 'USD',
      kind: AccountKind.TREASURY,
    });
    const pending = await ledgerService.ensureAccount({
      ownerUserId: null,
      currencyCode: 'USD',
      kind: AccountKind.WITHDRAWAL_PENDING,
    });
    const wallet = await ledgerService.ensureAccount({
      ownerUserId: await createTestUser(),
      currencyCode: 'USD',
      kind: AccountKind.USER_WALLET,
    });

    await ledgerService.postEntry({
      type: JournalEntryType.DEPOSIT,
      lines: [
        {
          accountId: treasury.id,
          direction: JournalLineDirection.DEBIT,
          amount: '100.00',
          currencyCode: 'USD',
        },
        {
          accountId: wallet.id,
          direction: JournalLineDirection.CREDIT,
          amount: '100.00',
          currencyCode: 'USD',
        },
      ],
    });

    // 10 parallel debits of 15.00 against a 100.00 balance: exactly 6 (90.00) can be afforded.
    const debitAmount = '15.00';
    const attempts = 10;

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        ledgerService.postEntry({
          type: JournalEntryType.WITHDRAWAL_HOLD,
          lines: [
            {
              accountId: wallet.id,
              direction: JournalLineDirection.DEBIT,
              amount: debitAmount,
              currencyCode: 'USD',
            },
            {
              accountId: pending.id,
              direction: JournalLineDirection.CREDIT,
              amount: debitAmount,
              currencyCode: 'USD',
            },
          ],
        }),
      ),
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(succeeded).toHaveLength(6);
    expect(failed).toHaveLength(4);
    for (const failure of failed) {
      expect(failure.reason).toBeInstanceOf(InsufficientFundsException);
    }

    const { balance } = await ledgerService.getBalance(wallet.id);
    expect(balance).toBe('10.00000000'); // 100.00 - 6 * 15.00
    expect(new Decimal(balance).isNegative()).toBe(false);
    await expectBalanceMatchesJournal(wallet.id);
    await expectBalanceMatchesJournal(pending.id);
  });
});
