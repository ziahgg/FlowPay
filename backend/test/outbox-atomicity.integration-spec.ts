import { randomUUID } from 'crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CommonModule } from '../src/common/common.module';
import { KafkaEventConsumer } from '../src/common/kafka/kafka-event-consumer';
import { KafkaEventProducer } from '../src/common/kafka/kafka-event-producer';
import { DomainEventType } from '../src/common/outbox/domain-event-type.enum';
import { OutboxEvent } from '../src/common/outbox/entities/outbox-event.entity';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { DepositsModule } from '../src/deposits/deposits.module';
import { DepositsService } from '../src/deposits/deposits.service';
import { AccountKind } from '../src/ledger/entities/account-kind.enum';
import { Currency } from '../src/ledger/entities/currency.entity';
import { CurrencyType } from '../src/ledger/entities/currency-type.enum';
import { JournalEntryType } from '../src/ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../src/ledger/entities/journal-line-direction.enum';
import { LedgerService } from '../src/ledger/ledger.service';
import { CreateLedgerCore1751600000000 } from '../src/migrations/1751600000000-CreateLedgerCore';
import { CreateUsersTable1751500000000 } from '../src/migrations/1751500000000-CreateUsersTable';
import { CreateOutbox1752000000000 } from '../src/migrations/1752000000000-CreateOutbox';

jest.setTimeout(120_000);

/**
 * Proves the transactional outbox pattern's core guarantee: appending an outbox row happens in
 * the SAME database transaction as the domain write it describes. No mock ever stands in for
 * Postgres's own transaction semantics here -- a real Postgres (via Testcontainers) is what
 * actually enforces the rollback, exactly like ledger.integration-spec.ts and
 * orders-race.integration-spec.ts already do for their own atomicity guarantees. Kafka itself is
 * a fake (see kafka.module.ts precedent notes) since nothing here exercises publishing.
 */
describe('Transactional outbox atomicity (integration, real Postgres via Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let ledgerService: LedgerService;
  let outboxService: OutboxService;
  let depositsService: DepositsService;
  let userId: string;
  let treasuryId: string;
  let walletId: string;

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
      migrations: [
        CreateUsersTable1751500000000,
        CreateLedgerCore1751600000000,
        CreateOutbox1752000000000,
      ],
    });
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    await migrationDataSource.destroy();

    moduleRef = await Test.createTestingModule({
      imports: [
        CommonModule,
        TypeOrmModule.forRoot({
          type: 'postgres',
          ...connectionOptions,
          autoLoadEntities: true,
          synchronize: false,
        }),
        DepositsModule,
      ],
    })
      // No real Kafka broker in this test -- these two are never exercised (nothing here
      // publishes), but Nest still instantiates every provider in the module graph at bootstrap,
      // so the real classes' onModuleInit would otherwise try to connect to a broker that isn't
      // running here.
      .overrideProvider(KafkaEventProducer)
      .useValue({ send: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(KafkaEventConsumer)
      .useValue({ subscribe: jest.fn().mockResolvedValue(undefined) })
      .compile();

    dataSource = moduleRef.get(DataSource);
    ledgerService = moduleRef.get(LedgerService);
    outboxService = moduleRef.get(OutboxService);
    depositsService = moduleRef.get(DepositsService);

    await dataSource.getRepository(Currency).save({
      code: 'USD',
      name: 'US Dollar',
      type: CurrencyType.FIAT,
      decimals: 2,
    });

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'x', 'user')`,
      [userId, `${userId}@example.com`],
    );

    const [treasury, wallet] = await Promise.all([
      ledgerService.ensureAccount({
        ownerUserId: null,
        currencyCode: 'USD',
        kind: AccountKind.TREASURY,
      }),
      ledgerService.ensureAccount({
        ownerUserId: userId,
        currencyCode: 'USD',
        kind: AccountKind.USER_WALLET,
      }),
    ]);
    treasuryId = treasury.id;
    walletId = wallet.id;
  });

  afterAll(async () => {
    await moduleRef.close();
    await container.stop();
  });

  async function countOutboxRows(): Promise<number> {
    return dataSource.getRepository(OutboxEvent).count();
  }

  it('creates the outbox row atomically with the ledger entry on a successful deposit', async () => {
    const before = await countOutboxRows();

    const result = await depositsService.deposit(userId, 'jane@example.com', 'USD', '25.00');

    expect(result.balance).toBeDefined();
    const after = await countOutboxRows();
    expect(after).toBe(before + 1);

    const rows = await dataSource
      .getRepository(OutboxEvent)
      .find({ where: { eventType: DomainEventType.DEPOSIT_COMPLETED } });
    const row = rows.find((r) => r.payload.amount === '25.00');
    expect(row).toBeDefined();
    expect(row?.payload).toMatchObject({
      recipientEmail: 'jane@example.com',
      currency: 'USD',
      amount: '25.00',
    });
    expect(row?.publishedAt).toBeNull();
  });

  it('rolls back the outbox row when the ledger write in the same transaction fails', async () => {
    const before = await countOutboxRows();
    const aggregateId = randomUUID();

    await expect(
      dataSource.transaction(async (manager) => {
        await outboxService.append(
          {
            eventType: DomainEventType.DEPOSIT_COMPLETED,
            aggregateId,
            payload: { recipientEmail: 'nobody@example.com', currency: 'USD', amount: '10.00' },
          },
          manager,
        );

        // Deliberately unbalanced (debit 10.00, credit 5.00) -- LedgerService.postEntry's
        // validator rejects this before it ever reaches the database, throwing inside the same
        // transaction as the outbox append just above.
        await ledgerService.postEntry(
          {
            type: JournalEntryType.DEPOSIT,
            lines: [
              {
                accountId: treasuryId,
                direction: JournalLineDirection.DEBIT,
                amount: '10.00',
                currencyCode: 'USD',
              },
              {
                accountId: walletId,
                direction: JournalLineDirection.CREDIT,
                amount: '5.00',
                currencyCode: 'USD',
              },
            ],
          },
          manager,
        );
      }),
    ).rejects.toThrow();

    const after = await countOutboxRows();
    expect(after).toBe(before);

    const orphan = await dataSource.getRepository(OutboxEvent).findOne({ where: { aggregateId } });
    expect(orphan).toBeNull();
  });
});
