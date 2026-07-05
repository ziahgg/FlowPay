import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, Repository } from 'typeorm';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { DomainEventType } from '../common/outbox/domain-event-type.enum';
import { OutboxService } from '../common/outbox/outbox.service';
import { TradeExecutionService } from '../common/trade-execution/trade-execution.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { Currency } from '../ledger/entities/currency.entity';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { LedgerService } from '../ledger/ledger.service';
import { RatesService } from '../rates/rates.service';
import { UsersService } from '../users/users.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { Order } from './entities/order.entity';
import { OrderSide } from './entities/order-side.enum';
import { OrderStatus } from './entities/order-status.enum';
import { OrderType } from './entities/order-type.enum';
import { computeHoldAmount, holdCurrencyCode } from './order-math.util';
import { splitPair } from './pair.util';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly ratesService: RatesService,
    private readonly tradeExecutionService: TradeExecutionService,
    private readonly usersService: UsersService,
    private readonly outboxService: OutboxService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,
  ) {}

  async createOrder(userId: string, dto: CreateOrderDto): Promise<OrderResponseDto> {
    const { base, quote } = await this.resolvePair(dto.pair);

    return dto.type === OrderType.MARKET
      ? this.executeMarketOrder(userId, base, quote, dto)
      : this.placeLimitOrder(userId, base, quote, dto);
  }

  /**
   * No real matching engine: the order executes immediately against the platform (treasury) at
   * the current cached market rate -- there is no spread applied here (unlike FX conversion),
   * matching the task's literal "at market price". See README "Trading quickstart".
   */
  private async executeMarketOrder(
    userId: string,
    base: Currency,
    quote: Currency,
    dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    const { rate } = await this.ratesService.getRate(base.code, quote.code);
    const quantity = new Decimal(dto.quantity).toDecimalPlaces(
      base.decimals,
      Decimal.ROUND_HALF_EVEN,
    );
    const quoteAmount = quantity
      .times(rate)
      .toDecimalPlaces(quote.decimals, Decimal.ROUND_HALF_EVEN);

    const isBuy = dto.side === OrderSide.BUY;
    const quantityFixed = quantity.toFixed(base.decimals);
    const quoteAmountFixed = quoteAmount.toFixed(quote.decimals);
    const pair = `${base.code}/${quote.code}`;

    const saved = await this.dataSource.transaction(async (manager) => {
      const swapResult = await this.tradeExecutionService.executeSwap(
        {
          source: {
            ownerUserId: userId,
            currencyCode: isBuy ? quote.code : base.code,
            kind: AccountKind.USER_WALLET,
          },
          fromAmount: isBuy ? quoteAmountFixed : quantityFixed,
          toUserId: userId,
          toCurrencyCode: isBuy ? base.code : quote.code,
          toAmount: isBuy ? quantityFixed : quoteAmountFixed,
          entryType: JournalEntryType.TRADE,
          description: `Market ${dto.side} of ${quantityFixed} ${base.code} at ${rate.toString()} ${quote.code}`,
          metadata: { pair, side: dto.side, type: dto.type, price: rate.toString() },
        },
        manager,
      );

      const repository = manager.getRepository(Order);
      const order = repository.create({
        userId,
        pair,
        side: dto.side,
        type: OrderType.MARKET,
        quantity: quantityFixed,
        limitPrice: null,
        status: OrderStatus.FILLED,
        holdEntryId: null,
        fillEntryId: swapResult.entryId,
        filledPrice: rate.toFixed(quote.decimals),
        filledAt: new Date(),
      });
      const savedOrder = await repository.save(order);

      const user = await this.usersService.findById(userId);
      await this.outboxService.append(
        {
          eventType: DomainEventType.ORDER_FILLED,
          aggregateId: savedOrder.id,
          payload: {
            recipientEmail: user?.email ?? null,
            pair,
            side: dto.side,
            quantity: quantityFixed,
            filledPrice: rate.toFixed(quote.decimals),
          },
        },
        manager,
      );

      return savedOrder;
    });

    return this.toDto(saved);
  }

  /**
   * Places a hold on the spending currency (same hold pattern as withdrawals) into the pooled
   * `trade_hold[currency]` system account, and creates the order + hold entry atomically. The
   * worker (OrdersWorkerService) picks it up from here.
   */
  private async placeLimitOrder(
    userId: string,
    base: Currency,
    quote: Currency,
    dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    const quantity = new Decimal(dto.quantity)
      .toDecimalPlaces(base.decimals, Decimal.ROUND_HALF_EVEN)
      .toFixed(base.decimals);
    const limitPrice = new Decimal(dto.limitPrice!)
      .toDecimalPlaces(quote.decimals, Decimal.ROUND_HALF_EVEN)
      .toFixed(quote.decimals);
    const pair = `${base.code}/${quote.code}`;

    const holdCurrencyCd = holdCurrencyCode(dto.side, base.code, quote.code);
    const holdAmount = computeHoldAmount({
      side: dto.side,
      quantity,
      limitPrice,
      baseDecimals: base.decimals,
      quoteDecimals: quote.decimals,
    });

    const created = await this.dataSource.transaction(async (manager) => {
      const [userAccount, tradeHoldAccount] = await Promise.all([
        this.ledgerService.ensureAccount({
          ownerUserId: userId,
          currencyCode: holdCurrencyCd,
          kind: AccountKind.USER_WALLET,
        }),
        this.ledgerService.ensureAccount({
          ownerUserId: null,
          currencyCode: holdCurrencyCd,
          kind: AccountKind.TRADE_HOLD,
        }),
      ]);

      const holdResult = await this.ledgerService.postEntry(
        {
          type: JournalEntryType.TRADE_HOLD,
          description: `Trade hold of ${holdAmount} ${holdCurrencyCd} for ${dto.side} limit order on ${pair}`,
          metadata: { pair, side: dto.side, quantity, limitPrice },
          lines: [
            {
              accountId: userAccount.id,
              direction: JournalLineDirection.DEBIT,
              amount: holdAmount,
              currencyCode: holdCurrencyCd,
            },
            {
              accountId: tradeHoldAccount.id,
              direction: JournalLineDirection.CREDIT,
              amount: holdAmount,
              currencyCode: holdCurrencyCd,
            },
          ],
        },
        manager,
      );

      const repository = manager.getRepository(Order);
      const order = repository.create({
        userId,
        pair,
        side: dto.side,
        type: OrderType.LIMIT,
        quantity,
        limitPrice,
        status: OrderStatus.OPEN,
        holdEntryId: holdResult.entryId,
      });

      return repository.save(order);
    });

    return this.toDto(created);
  }

  /**
   * Only an 'open' order can be cancelled. The row lock here and the one OrdersWorkerService.tryFill
   * takes on the same row are what make the cancel-vs-fill race safe: whichever transaction commits
   * first "wins", and the other sees the already-updated status once it acquires the lock.
   */
  async cancelOrder(userId: string, orderId: string): Promise<OrderResponseDto> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order || order.userId !== userId) {
        throw new NotFoundException('Order not found');
      }
      if (order.status !== OrderStatus.OPEN) {
        throw new ConflictException(`Order is already ${order.status}`);
      }

      const { baseCode, quoteCode } = splitPair(order.pair);
      const [base, quote] = await Promise.all([
        this.ledgerService.getCurrency(baseCode),
        this.ledgerService.getCurrency(quoteCode),
      ]);

      const holdCurrencyCd = holdCurrencyCode(order.side, base.code, quote.code);
      const holdAmount = computeHoldAmount({
        side: order.side,
        quantity: order.quantity,
        limitPrice: order.limitPrice!,
        baseDecimals: base.decimals,
        quoteDecimals: quote.decimals,
      });

      const [tradeHoldAccount, userAccount] = await Promise.all([
        this.ledgerService.ensureAccount({
          ownerUserId: null,
          currencyCode: holdCurrencyCd,
          kind: AccountKind.TRADE_HOLD,
        }),
        this.ledgerService.ensureAccount({
          ownerUserId: userId,
          currencyCode: holdCurrencyCd,
          kind: AccountKind.USER_WALLET,
        }),
      ]);

      await this.ledgerService.postEntry(
        {
          type: JournalEntryType.TRADE_RELEASE,
          description: `Trade hold release of ${holdAmount} ${holdCurrencyCd} for cancelled order ${order.id}`,
          metadata: { orderId: order.id, pair: order.pair, side: order.side },
          lines: [
            {
              accountId: tradeHoldAccount.id,
              direction: JournalLineDirection.DEBIT,
              amount: holdAmount,
              currencyCode: holdCurrencyCd,
            },
            {
              accountId: userAccount.id,
              direction: JournalLineDirection.CREDIT,
              amount: holdAmount,
              currencyCode: holdCurrencyCd,
            },
          ],
        },
        manager,
      );

      order.status = OrderStatus.CANCELLED;
      return manager.save(order);
    });

    return this.toDto(updated);
  }

  async listForUser(
    userId: string,
    filter: { status?: OrderStatus },
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResponseDto<OrderResponseDto>> {
    const [items, total] = await this.orderRepository.findAndCount({
      where: filter.status ? { userId, status: filter.status } : { userId },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return {
      data: items.map((item) => this.toDto(item)),
      meta: { page: pagination.page, limit: pagination.limit, total },
    };
  }

  private async resolvePair(pair: string): Promise<{ base: Currency; quote: Currency }> {
    const { baseCode, quoteCode } = splitPair(pair);
    const [base, quote] = await Promise.all([
      this.ledgerService.getCurrency(baseCode),
      this.ledgerService.getCurrency(quoteCode),
    ]);

    if (base.code === quote.code) {
      throw new UnprocessableEntityException('Base and quote currencies must differ');
    }

    return { base, quote };
  }

  private toDto(entity: Order): OrderResponseDto {
    return {
      id: entity.id,
      pair: entity.pair,
      side: entity.side,
      type: entity.type,
      quantity: entity.quantity,
      limitPrice: entity.limitPrice,
      status: entity.status,
      holdEntryId: entity.holdEntryId,
      fillEntryId: entity.fillEntryId,
      filledPrice: entity.filledPrice,
      filledAt: entity.filledAt,
      createdAt: entity.createdAt,
    };
  }
}
