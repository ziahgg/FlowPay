import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { PinoLogger } from 'nestjs-pino';
import { EnvConfig } from '../common/config/env.schema';
import { TradeExecutionService } from '../common/trade-execution/trade-execution.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { CurrencyType } from '../ledger/entities/currency-type.enum';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { LedgerService } from '../ledger/ledger.service';
import { RateProvider } from '../rates/interfaces/rate-provider.interface';
import { CoinGeckoRateProvider } from '../rates/providers/coingecko-rate.provider';
import { StaticRateProvider } from '../rates/providers/static-rate.provider';
import { RatesService } from '../rates/rates.service';
import { Order } from './entities/order.entity';
import { OrderSide } from './entities/order-side.enum';
import { OrderStatus } from './entities/order-status.enum';
import { OrderType } from './entities/order-type.enum';
import { OrdersWorkerService } from './orders-worker.service';

const CURRENCIES: Record<
  string,
  { code: string; name: string; type: CurrencyType; decimals: number }
> = {
  BTC: { code: 'BTC', name: 'Bitcoin', type: CurrencyType.CRYPTO, decimals: 8 },
  USD: { code: 'USD', name: 'US Dollar', type: CurrencyType.FIAT, decimals: 2 },
};

/** A real RateProvider implementation with fully controllable, injectable prices. */
class FakeRateProvider implements RateProvider {
  readonly name = 'fake';
  constructor(private readonly prices: Map<string, Decimal>) {}

  getUsdPrices(): Promise<Map<string, Decimal>> {
    return Promise.resolve(this.prices);
  }
}

function buildRatesService(btcUsdPrice: number): RatesService {
  const fakeProvider = new FakeRateProvider(
    new Map([
      ['BTC', new Decimal(btcUsdPrice)],
      ['USD', new Decimal(1)],
    ]),
  );
  const staticProviderStub = { name: 'static-fallback', getUsdPrices: jest.fn() };
  const configServiceStub = { get: jest.fn().mockReturnValue(30_000) };
  const loggerStub = { setContext: jest.fn(), warn: jest.fn() };

  return new RatesService(
    fakeProvider as unknown as CoinGeckoRateProvider,
    staticProviderStub as unknown as StaticRateProvider,
    configServiceStub as unknown as ConfigService<EnvConfig, true>,
    loggerStub as unknown as PinoLogger,
  );
}

describe('OrdersWorkerService', () => {
  let ledgerService: jest.Mocked<Pick<LedgerService, 'getCurrency'>>;
  let tradeExecutionService: jest.Mocked<Pick<TradeExecutionService, 'executeSwap'>>;
  let dataSource: { transaction: jest.Mock };
  let orderRepository: { find: jest.Mock };
  let logger: { setContext: jest.Mock; error: jest.Mock };

  const buildOrder = (overrides: Partial<Order> = {}): Order => ({
    id: 'order-1',
    userId: 'user-1',
    pair: 'BTC/USD',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    quantity: '0.01000000',
    limitPrice: '50000.00',
    status: OrderStatus.OPEN,
    holdEntryId: 'hold-entry-1',
    fillEntryId: null,
    filledPrice: null,
    filledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  const fakeManager = (order: Order | null) => ({
    findOne: jest.fn().mockResolvedValue(order),
    save: jest.fn((entity: Order) => Promise.resolve(entity)),
  });

  function buildWorker(ratesService: RatesService, order: Order | null): OrdersWorkerService {
    const manager = fakeManager(order);
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

    return new OrdersWorkerService(
      ledgerService as unknown as LedgerService,
      ratesService,
      tradeExecutionService as unknown as TradeExecutionService,
      dataSource as never,
      orderRepository as never,
      logger as unknown as PinoLogger,
    );
  }

  beforeEach(() => {
    ledgerService = {
      getCurrency: jest
        .fn()
        .mockImplementation((code: string) => Promise.resolve(CURRENCIES[code])),
    };
    tradeExecutionService = {
      executeSwap: jest.fn().mockResolvedValue({
        entryId: 'fill-entry-1',
        sourceBalance: '0.00',
        toBalance: '0.01000000',
      }),
    };
    dataSource = { transaction: jest.fn() };
    orderRepository = { find: jest.fn() };
    logger = { setContext: jest.fn(), error: jest.fn() };
  });

  describe('tryFill -- buy limit order', () => {
    it('fills when the market rate is at or below the limit price', async () => {
      const order = buildOrder({ side: OrderSide.BUY, limitPrice: '50000.00' });
      const worker = buildWorker(buildRatesService(49_500), order);

      const filled = await worker.tryFill('order-1');

      expect(filled).toBe(true);
      expect(tradeExecutionService.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { ownerUserId: null, currencyCode: 'USD', kind: AccountKind.TRADE_HOLD },
          fromAmount: '500.00', // 0.01 * 50000 limit price
          toUserId: 'user-1',
          toCurrencyCode: 'BTC',
          toAmount: '0.01000000',
          entryType: JournalEntryType.TRADE,
        }),
        expect.anything(),
      );
    });

    it('does not fill when the market rate is still above the limit price', async () => {
      const order = buildOrder({ side: OrderSide.BUY, limitPrice: '50000.00' });
      const worker = buildWorker(buildRatesService(50_500), order);

      const filled = await worker.tryFill('order-1');

      expect(filled).toBe(false);
      expect(tradeExecutionService.executeSwap).not.toHaveBeenCalled();
    });
  });

  describe('tryFill -- sell limit order', () => {
    it('fills when the market rate is at or above the limit price', async () => {
      const order = buildOrder({ side: OrderSide.SELL, limitPrice: '50000.00' });
      const worker = buildWorker(buildRatesService(50_500), order);

      const filled = await worker.tryFill('order-1');

      expect(filled).toBe(true);
      expect(tradeExecutionService.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { ownerUserId: null, currencyCode: 'BTC', kind: AccountKind.TRADE_HOLD },
          fromAmount: '0.01000000',
          toUserId: 'user-1',
          toCurrencyCode: 'USD',
          toAmount: '500.00',
        }),
        expect.anything(),
      );
    });

    it('does not fill when the market rate is still below the limit price', async () => {
      const order = buildOrder({ side: OrderSide.SELL, limitPrice: '50000.00' });
      const worker = buildWorker(buildRatesService(49_500), order);

      const filled = await worker.tryFill('order-1');

      expect(filled).toBe(false);
      expect(tradeExecutionService.executeSwap).not.toHaveBeenCalled();
    });
  });

  it('marks the order filled with the fill entry id and limit price', async () => {
    const order = buildOrder();
    const worker = buildWorker(buildRatesService(49_000), order);

    await worker.tryFill('order-1');

    expect(order.status).toBe(OrderStatus.FILLED);
    expect(order.fillEntryId).toBe('fill-entry-1');
    expect(order.filledPrice).toBe('50000.00');
    expect(order.filledAt).toBeInstanceOf(Date);
  });

  it('is a safe no-op when the order is no longer open (already resolved by a cancel or a prior fill)', async () => {
    const order = buildOrder({ status: OrderStatus.CANCELLED });
    const worker = buildWorker(buildRatesService(1), order);

    const filled = await worker.tryFill('order-1');

    expect(filled).toBe(false);
    expect(tradeExecutionService.executeSwap).not.toHaveBeenCalled();
  });

  it('is a safe no-op when the order no longer exists', async () => {
    const worker = buildWorker(buildRatesService(1), null);

    const filled = await worker.tryFill('order-1');

    expect(filled).toBe(false);
  });

  describe('scanAndFillOpenOrders', () => {
    it('evaluates every open limit order and continues past one that throws', async () => {
      const crossedOrder = buildOrder({ id: 'order-1', limitPrice: '50000.00' });
      const explodingOrder = buildOrder({ id: 'order-2', limitPrice: '50000.00' });
      orderRepository.find.mockResolvedValue([explodingOrder, crossedOrder]);

      const ratesService = buildRatesService(49_000);
      const manager = {
        findOne: jest.fn((_entity: unknown, options: { where: { id: string } }) => {
          if (options.where.id === 'order-2') {
            throw new Error('boom');
          }
          return Promise.resolve(crossedOrder);
        }),
        save: jest.fn((entity: Order) => Promise.resolve(entity)),
      };
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      const worker = new OrdersWorkerService(
        ledgerService as unknown as LedgerService,
        ratesService,
        tradeExecutionService as unknown as TradeExecutionService,
        dataSource as never,
        orderRepository as never,
        logger as unknown as PinoLogger,
      );

      await worker.scanAndFillOpenOrders();

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { status: OrderStatus.OPEN, type: OrderType.LIMIT },
      });
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(tradeExecutionService.executeSwap).toHaveBeenCalledTimes(1);
    });
  });
});
