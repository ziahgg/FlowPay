import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DomainEventType } from '../common/outbox/domain-event-type.enum';
import { OutboxService } from '../common/outbox/outbox.service';
import { TradeExecutionService } from '../common/trade-execution/trade-execution.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { CurrencyType } from '../ledger/entities/currency-type.enum';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { EnsureAccountInput } from '../ledger/interfaces/ensure-account.interface';
import { LedgerService } from '../ledger/ledger.service';
import { RatesService } from '../rates/rates.service';
import { UsersService } from '../users/users.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './entities/order.entity';
import { OrderSide } from './entities/order-side.enum';
import { OrderStatus } from './entities/order-status.enum';
import { OrderType } from './entities/order-type.enum';
import { OrdersService } from './orders.service';

const CURRENCIES: Record<
  string,
  { code: string; name: string; type: CurrencyType; decimals: number }
> = {
  BTC: { code: 'BTC', name: 'Bitcoin', type: CurrencyType.CRYPTO, decimals: 8 },
  USD: { code: 'USD', name: 'US Dollar', type: CurrencyType.FIAT, decimals: 2 },
};

describe('OrdersService', () => {
  let service: OrdersService;
  let ledgerService: jest.Mocked<
    Pick<LedgerService, 'getCurrency' | 'ensureAccount' | 'postEntry'>
  >;
  let ratesService: jest.Mocked<Pick<RatesService, 'getRate'>>;
  let tradeExecutionService: jest.Mocked<Pick<TradeExecutionService, 'executeSwap'>>;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let outboxService: jest.Mocked<Pick<OutboxService, 'append'>>;
  let dataSource: { transaction: jest.Mock };
  let orderRepository: { create: jest.Mock; save: jest.Mock; findAndCount: jest.Mock };

  const userId = 'user-1';

  const createOrderRow = (overrides: Partial<Order> = {}): Order => ({
    id: 'order-1',
    userId,
    pair: 'BTC/USD',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    quantity: '0.01000000',
    limitPrice: '45000.00',
    status: OrderStatus.OPEN,
    holdEntryId: 'hold-entry-1',
    fillEntryId: null,
    filledPrice: null,
    filledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  const fakeManager = (findOneResult: Order | null) => ({
    findOne: jest.fn().mockResolvedValue(findOneResult),
    getRepository: () => ({
      create: (data: Partial<Order>) => data,
      save: jest.fn((data: Partial<Order>) => Promise.resolve({ id: 'order-new', ...data })),
    }),
    save: jest.fn((entity: Order) => Promise.resolve(entity)),
  });

  beforeEach(() => {
    ledgerService = {
      getCurrency: jest
        .fn()
        .mockImplementation((code: string) => Promise.resolve(CURRENCIES[code])),
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
      postEntry: jest.fn().mockResolvedValue({ entryId: 'hold-entry-1', balances: {} }),
    };

    ratesService = { getRate: jest.fn() };

    tradeExecutionService = {
      executeSwap: jest.fn().mockResolvedValue({
        entryId: 'fill-entry-1',
        sourceBalance: '900.00',
        toBalance: '0.01000000',
      }),
    };

    usersService = {
      findById: jest.fn().mockResolvedValue({ id: userId, email: 'jane@example.com' }),
    };
    outboxService = { append: jest.fn().mockResolvedValue(undefined) };

    dataSource = { transaction: jest.fn() };
    // Default: no pre-existing row (fine for market-order creation, which only ever inserts).
    // Tests needing a specific existing row (limit placement/cancel) override this per-test.
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
      cb(fakeManager(null)),
    );
    orderRepository = {
      create: jest.fn((data: Partial<Order>) => data),
      save: jest.fn((data: Partial<Order>) => Promise.resolve({ id: 'order-1', ...data })),
      findAndCount: jest.fn(),
    };

    service = new OrdersService(
      ledgerService as unknown as LedgerService,
      ratesService as unknown as RatesService,
      tradeExecutionService as unknown as TradeExecutionService,
      usersService as unknown as UsersService,
      outboxService,
      dataSource as never,
      orderRepository as never,
    );
  });

  describe('createOrder -- market', () => {
    const marketDto = (side: OrderSide): CreateOrderDto => ({
      pair: 'BTC/USD',
      side,
      type: OrderType.MARKET,
      quantity: '0.01',
    });

    it('buys base with quote at the current rate, no spread', async () => {
      ratesService.getRate.mockResolvedValue({
        rate: new Decimal(50_000),
        source: 'coingecko',
        asOf: new Date(),
      });

      const result = await service.createOrder(userId, marketDto(OrderSide.BUY));

      expect(tradeExecutionService.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { ownerUserId: userId, currencyCode: 'USD', kind: AccountKind.USER_WALLET },
          fromAmount: '500.00',
          toUserId: userId,
          toCurrencyCode: 'BTC',
          toAmount: '0.01000000',
          entryType: JournalEntryType.TRADE,
        }),
        expect.anything(),
      );
      expect(result.status).toBe(OrderStatus.FILLED);
      expect(result.filledPrice).toBe('50000.00');
      expect(result.fillEntryId).toBe('fill-entry-1');
      expect(result.holdEntryId).toBeNull();

      expect(outboxService.append).toHaveBeenCalledWith(
        {
          eventType: DomainEventType.ORDER_FILLED,
          aggregateId: result.id,
          payload: {
            recipientEmail: 'jane@example.com',
            pair: 'BTC/USD',
            side: OrderSide.BUY,
            quantity: '0.01000000',
            filledPrice: '50000.00',
          },
        },
        expect.anything(),
      );
    });

    it('sells base for quote at the current rate', async () => {
      ratesService.getRate.mockResolvedValue({
        rate: new Decimal(50_000),
        source: 'coingecko',
        asOf: new Date(),
      });

      await service.createOrder(userId, marketDto(OrderSide.SELL));

      expect(tradeExecutionService.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { ownerUserId: userId, currencyCode: 'BTC', kind: AccountKind.USER_WALLET },
          fromAmount: '0.01000000',
          toUserId: userId,
          toCurrencyCode: 'USD',
          toAmount: '500.00',
        }),
        expect.anything(),
      );
    });

    it('rounds the quote amount half-even at the quote currency decimals', async () => {
      ratesService.getRate.mockResolvedValue({
        rate: new Decimal('2.125'),
        source: 'coingecko',
        asOf: new Date(),
      });

      await service.createOrder(userId, { ...marketDto(OrderSide.BUY), quantity: '1' });

      // 1 * 2.125 = 2.125, exactly at the rounding midpoint -- half-even keeps the even digit.
      expect(tradeExecutionService.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({ fromAmount: '2.12' }),
        expect.anything(),
      );
    });

    it('rejects a pair whose base and quote are the same currency', async () => {
      await expect(
        service.createOrder(userId, { ...marketDto(OrderSide.BUY), pair: 'USD/USD' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(tradeExecutionService.executeSwap).not.toHaveBeenCalled();
    });
  });

  describe('createOrder -- limit', () => {
    const limitDto = (side: OrderSide): CreateOrderDto => ({
      pair: 'BTC/USD',
      side,
      type: OrderType.LIMIT,
      quantity: '0.01',
      limitPrice: '45000',
    });

    it('holds quote currency = quantity * limitPrice for a buy order', async () => {
      const manager = fakeManager(null);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      const result = await service.createOrder(userId, limitDto(OrderSide.BUY));

      expect(ledgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          type: JournalEntryType.TRADE_HOLD,
          lines: [
            {
              accountId: `${AccountKind.USER_WALLET}-USD-${userId}`,
              direction: JournalLineDirection.DEBIT,
              amount: '450.00',
              currencyCode: 'USD',
            },
            {
              accountId: `${AccountKind.TRADE_HOLD}-USD-system`,
              direction: JournalLineDirection.CREDIT,
              amount: '450.00',
              currencyCode: 'USD',
            },
          ],
        }),
        manager,
      );
      expect(result.status).toBe(OrderStatus.OPEN);
      expect(result.holdEntryId).toBe('hold-entry-1');
    });

    it('holds base currency = quantity for a sell order, independent of price', async () => {
      const manager = fakeManager(null);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      await service.createOrder(userId, limitDto(OrderSide.SELL));

      expect(ledgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [
            {
              accountId: `${AccountKind.USER_WALLET}-BTC-${userId}`,
              direction: JournalLineDirection.DEBIT,
              amount: '0.01000000',
              currencyCode: 'BTC',
            },
            {
              accountId: `${AccountKind.TRADE_HOLD}-BTC-system`,
              direction: JournalLineDirection.CREDIT,
              amount: '0.01000000',
              currencyCode: 'BTC',
            },
          ],
        }),
        manager,
      );
    });
  });

  describe('cancelOrder', () => {
    it('releases the hold and marks the order cancelled', async () => {
      const manager = fakeManager(createOrderRow());
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      const result = await service.cancelOrder(userId, 'order-1');

      expect(ledgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          type: JournalEntryType.TRADE_RELEASE,
          lines: [
            {
              accountId: `${AccountKind.TRADE_HOLD}-USD-system`,
              direction: JournalLineDirection.DEBIT,
              amount: '450.00',
              currencyCode: 'USD',
            },
            {
              accountId: `${AccountKind.USER_WALLET}-USD-${userId}`,
              direction: JournalLineDirection.CREDIT,
              amount: '450.00',
              currencyCode: 'USD',
            },
          ],
        }),
        manager,
      );
      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('rejects with 404 when the order does not exist', async () => {
      const manager = fakeManager(null);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      await expect(service.cancelOrder(userId, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects with 404 when the order belongs to another user (does not leak existence)', async () => {
      const manager = fakeManager(createOrderRow({ userId: 'someone-else' }));
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      await expect(service.cancelOrder(userId, 'order-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects with 409 when the order is no longer open', async () => {
      const manager = fakeManager(createOrderRow({ status: OrderStatus.FILLED }));
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

      await expect(service.cancelOrder(userId, 'order-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(ledgerService.postEntry).not.toHaveBeenCalled();
    });
  });
});
