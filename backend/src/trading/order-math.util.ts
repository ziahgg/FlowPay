import Decimal from 'decimal.js';
import { OrderSide } from './entities/order-side.enum';

/**
 * A limit order's hold is sized so the worst case it can ever cost the user is exactly what's
 * held -- no partial release/reconciliation needed at fill time (see README "Trading quickstart"):
 * - BUY: holds the *quote* currency, `quantity * limitPrice` (the maximum the user could pay --
 *   the fill always executes at the limit price itself, never worse).
 * - SELL: holds the *base* currency, `quantity` (fixed, price-independent).
 *
 * Used identically at hold-placement, cancel-release, and worker-fill time so the amount posted
 * to the ledger is always byte-identical to what's already sitting in `trade_hold[currency]` --
 * recomputing from the order's own stored `quantity`/`limitPrice` is deterministic, so there's no
 * need for a separate "held amount" column.
 */
export function holdCurrencyCode(side: OrderSide, baseCode: string, quoteCode: string): string {
  return side === OrderSide.BUY ? quoteCode : baseCode;
}

export function computeHoldAmount(params: {
  side: OrderSide;
  quantity: string;
  limitPrice: string;
  baseDecimals: number;
  quoteDecimals: number;
}): string {
  if (params.side === OrderSide.BUY) {
    return new Decimal(params.quantity)
      .times(params.limitPrice)
      .toDecimalPlaces(params.quoteDecimals, Decimal.ROUND_HALF_EVEN)
      .toFixed(params.quoteDecimals);
  }

  return new Decimal(params.quantity)
    .toDecimalPlaces(params.baseDecimals, Decimal.ROUND_HALF_EVEN)
    .toFixed(params.baseDecimals);
}
