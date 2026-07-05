import { randomUUID } from 'crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { CommonModule } from '../src/common/common.module';
import { envSchema } from '../src/common/config/env.schema';
import { AccountKind } from '../src/ledger/entities/account-kind.enum';
import { Currency } from '../src/ledger/entities/currency.entity';
import { CurrencyType } from '../src/ledger/entities/currency-type.enum';
import { JournalEntryType } from '../src/ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../src/ledger/entities/journal-line-direction.enum';
import { LedgerService } from '../src/ledger/ledger.service';
import { CreateLedgerCore1751600000000 } from '../src/migrations/1751600000000-CreateLedgerCore';
import { CreateUsersTable1751500000000 } from '../src/migrations/1751500000000-CreateUsersTable';
import { CreateOrders1751900000000 } from '../src/migrations/1751900000000-CreateOrders';
import { RateProvider } from '../src/rates/interfaces/rate-provider.interface';
import { CoinGeckoRateProvider } from '../src/rates/providers/coingecko-rate.provider';
import { CreateOrderDto } from '../src/trading/dto/create-order.dto';
import { OrderSide } from '../src/trading/entities/order-side.enum';
import { OrderStatus } from '../src/trading/entities/order-status.enum';
import { OrderType } from '../src/trading/entities/order-type.enum';
import { OrdersService } from '../src/trading/orders.service';
import { OrdersWorkerService } from '../src/trading/orders-worker.service';
import { TradingModule } from '../src/trading/trading.module';

jest.setTimeout(120_000);

const defaultEnvConfig = envSchema.parse({});

/** A real RateProvider with a controllable BTC/USD price, so the race can reliably cross a limit. */
class FakeRateProvider implements RateProvider {
  readonly name = 'fake';
  btcUsdPrice = 50_000;

  getUsdPrices(): Promise<Map<string, Decimal>> {
    return Promise.resolve(
      new Map([
        ['BTC', new Decimal(this.btcUsdPrice)],
        ['USD', new Decimal(1)],
      ]),
    );
  }
}

describe('Orders cancel-vs-fill race (integration, real Postgres via Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let ledgerService: LedgerService;
  let ordersService: OrdersService;
  let ordersWorkerService: OrdersWorkerService;
  let fakeRateProvider: FakeRateProvider;
  let userId: string;

  const BUY_LIMIT_PRICE = '50000.00';

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
        CreateOrders1751900000000,
      ],
    });
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    await migrationDataSource.destroy();

    fakeRateProvider = new FakeRateProvider();

    moduleRef = await Test.createTestingModule({
      imports: [
        CommonModule,
        TypeOrmModule.forRoot({
          type: 'postgres',
          ...connectionOptions,
          autoLoadEntities: true,
          synchronize: false,
        }),
        TradingModule,
      ],
    })
      .overrideProvider(CoinGeckoRateProvider)
      .useValue(fakeRateProvider)
      // Effectively disables RatesService's cache so each test's price change (set on
      // fakeRateProvider before calling tryFill) takes effect immediately instead of serving a
      // stale snapshot from an earlier test in this file. Overriding the token directly sidesteps
      // @nestjs/config's own env-snapshot timing, which a `process.env` mutation here can't reach.
      // Every other key still gets its real schema default (LoggerModule needs a valid LOG_LEVEL).
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          key === 'RATE_CACHE_TTL_MS' ? 1 : (defaultEnvConfig as Record<string, unknown>)[key],
      })
      .compile();

    dataSource = moduleRef.get(DataSource);
    ledgerService = moduleRef.get(LedgerService);
    ordersService = moduleRef.get(OrdersService);
    ordersWorkerService = moduleRef.get(OrdersWorkerService);

    await dataSource.getRepository(Currency).save([
      { code: 'USD', name: 'US Dollar', type: CurrencyType.FIAT, decimals: 2 },
      { code: 'BTC', name: 'Bitcoin', type: CurrencyType.CRYPTO, decimals: 8 },
    ]);

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'x', 'user')`,
      [userId, `${userId}@example.com`],
    );

    // Fund the user with plenty of USD to place many buy limit orders across iterations.
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
    await ledgerService.postEntry({
      type: JournalEntryType.DEPOSIT,
      lines: [
        {
          accountId: treasury.id,
          direction: JournalLineDirection.DEBIT,
          amount: '1000000.00',
          currencyCode: 'USD',
        },
        {
          accountId: wallet.id,
          direction: JournalLineDirection.CREDIT,
          amount: '1000000.00',
          currencyCode: 'USD',
        },
      ],
    });
  });

  afterAll(async () => {
    await moduleRef.close();
    await container.stop();
  });

  async function getTradeHoldBalance(currencyCode: string): Promise<Decimal> {
    const tradeHold = await ledgerService.ensureAccount({
      ownerUserId: null,
      currencyCode,
      kind: AccountKind.TRADE_HOLD,
    });
    const { balance } = await ledgerService.getBalance(tradeHold.id);
    return new Decimal(balance);
  }

  async function placeCrossedBuyLimitOrder(): Promise<string> {
    const dto: CreateOrderDto = {
      pair: 'BTC/USD',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '0.01',
      limitPrice: BUY_LIMIT_PRICE,
    };
    const order = await ordersService.createOrder(userId, dto);
    return order.id;
  }

  /**
   * RATE_CACHE_TTL_MS is overridden to 1ms so each test's price change takes effect -- but
   * Date.now() has millisecond resolution, so two calls completing within the same tick could
   * still see a "fresh" cache. A short real wait after changing the price guarantees the next
   * getRate() call actually refetches from fakeRateProvider instead of racing the clock.
   */
  async function setPriceAndWaitForCacheExpiry(price: number): Promise<void> {
    fakeRateProvider.btcUsdPrice = price;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it('never lets both a cancel and a fill succeed for the same order, across many concurrent races', async () => {
    // The rate is already below the limit, so tryFill will consider every one of these orders
    // crossed the instant it acquires the row lock.
    await setPriceAndWaitForCacheExpiry(49_000);

    const iterations = 20;
    const holdBalanceBefore = await getTradeHoldBalance('USD');

    for (let i = 0; i < iterations; i++) {
      const orderId = await placeCrossedBuyLimitOrder();

      const [cancelResult, fillResult] = await Promise.allSettled([
        ordersService.cancelOrder(userId, orderId),
        ordersWorkerService.tryFill(orderId),
      ]);

      const cancelSucceeded = cancelResult.status === 'fulfilled';
      const fillSucceeded = fillResult.status === 'fulfilled' && fillResult.value === true;

      // Exactly one of the two ever wins -- never both, never neither.
      expect(cancelSucceeded !== fillSucceeded).toBe(true);

      const order = await dataSource.query<{ status: OrderStatus }[]>(
        `SELECT status FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(order[0].status).toBe(cancelSucceeded ? OrderStatus.CANCELLED : OrderStatus.FILLED);

      // A second fill attempt on the now-resolved order must be a safe no-op.
      const secondFill = await ordersWorkerService.tryFill(orderId);
      expect(secondFill).toBe(false);
    }

    // Every hold was released exactly once (via cancel, or consumed into the fill) -- the pooled
    // trade_hold[USD] balance nets back to exactly what it was before this whole run, regardless
    // of which side won each individual race.
    const holdBalanceAfter = await getTradeHoldBalance('USD');
    expect(holdBalanceAfter.equals(holdBalanceBefore)).toBe(true);
  });

  it('rejects cancelling an order that a concurrent fill already resolved', async () => {
    await setPriceAndWaitForCacheExpiry(49_000);
    const orderId = await placeCrossedBuyLimitOrder();

    const filled = await ordersWorkerService.tryFill(orderId);
    expect(filled).toBe(true);

    await expect(ordersService.cancelOrder(userId, orderId)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('leaves an order open (does not fill) when the rate has not crossed the limit', async () => {
    await setPriceAndWaitForCacheExpiry(51_000); // above the buy limit of 50000 -- not crossed
    const orderId = await placeCrossedBuyLimitOrder();

    const filled = await ordersWorkerService.tryFill(orderId);
    expect(filled).toBe(false);

    const cancelled = await ordersService.cancelOrder(userId, orderId);
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
  });
});
