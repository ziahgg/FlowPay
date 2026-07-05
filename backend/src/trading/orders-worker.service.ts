import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, Repository } from 'typeorm';
import { TradeExecutionService } from '../common/trade-execution/trade-execution.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { LedgerService } from '../ledger/ledger.service';
import { RatesService } from '../rates/rates.service';
import { Order } from './entities/order.entity';
import { OrderSide } from './entities/order-side.enum';
import { OrderStatus } from './entities/order-status.enum';
import { OrderType } from './entities/order-type.enum';
import { computeHoldAmount, holdCurrencyCode } from './order-math.util';
import { splitPair } from './pair.util';

/**
 * Scans open limit orders every ~10s and fills any whose limit has been crossed by the current
 * cached rate. No real matching engine: every fill executes against the platform (treasury) via
 * TradeExecutionService, at the order's own limit price (not the prevailing market rate) -- see
 * README "Trading quickstart" for why that keeps the hold amount exactly equal to the fill amount.
 */
@Injectable()
export class OrdersWorkerService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly ratesService: RatesService,
    private readonly tradeExecutionService: TradeExecutionService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OrdersWorkerService.name);
  }

  @Cron('*/10 * * * * *')
  async scanAndFillOpenOrders(): Promise<void> {
    const openOrders = await this.orderRepository.find({
      where: { status: OrderStatus.OPEN, type: OrderType.LIMIT },
    });

    for (const order of openOrders) {
      try {
        await this.tryFill(order.id);
      } catch (error) {
        this.logger.error(
          { err: error, orderId: order.id },
          'Failed to evaluate limit order for fill',
        );
      }
    }
  }

  /**
   * Row-locks the order and re-checks its status inside the same transaction -- this, plus the
   * identical lock in OrdersService.cancelOrder, is the cancel-vs-fill race guard: whichever
   * transaction acquires the lock first commits its outcome; the other sees the already-updated
   * status once it gets the lock and safely no-ops (returns false) rather than double-resolving.
   */
  async tryFill(orderId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order || order.status !== OrderStatus.OPEN || order.type !== OrderType.LIMIT) {
        return false;
      }

      const { baseCode, quoteCode } = splitPair(order.pair);
      const { rate } = await this.ratesService.getRate(baseCode, quoteCode);
      const limitPrice = new Decimal(order.limitPrice!);
      const isBuy = order.side === OrderSide.BUY;
      const crossed = isBuy
        ? rate.lessThanOrEqualTo(limitPrice)
        : rate.greaterThanOrEqualTo(limitPrice);

      if (!crossed) {
        return false;
      }

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
      const quoteAmount = new Decimal(order.quantity)
        .times(limitPrice)
        .toDecimalPlaces(quote.decimals, Decimal.ROUND_HALF_EVEN)
        .toFixed(quote.decimals);

      const swapResult = await this.tradeExecutionService.executeSwap(
        {
          source: {
            ownerUserId: null,
            currencyCode: holdCurrencyCd,
            kind: AccountKind.TRADE_HOLD,
          },
          fromAmount: holdAmount,
          toUserId: order.userId,
          toCurrencyCode: isBuy ? base.code : quote.code,
          toAmount: isBuy ? order.quantity : quoteAmount,
          entryType: JournalEntryType.TRADE,
          description: `Limit ${order.side} fill of ${order.quantity} ${base.code} at ${limitPrice.toFixed(quote.decimals)} ${quote.code}`,
          metadata: { orderId: order.id, pair: order.pair, side: order.side },
        },
        manager,
      );

      order.status = OrderStatus.FILLED;
      order.fillEntryId = swapResult.entryId;
      order.filledPrice = limitPrice.toFixed(quote.decimals);
      order.filledAt = new Date();
      await manager.save(order);

      return true;
    });
  }
}
