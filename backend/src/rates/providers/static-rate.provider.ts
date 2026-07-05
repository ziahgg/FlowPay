import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { RateProvider } from '../interfaces/rate-provider.interface';

/**
 * Seeded fallback rates, used whenever the live provider is unreachable so the app keeps working
 * offline. Values are a rough, static snapshot -- not live market data -- deliberately hardcoded
 * rather than configurable, since their only purpose is to keep the app functional, not accurate.
 */
@Injectable()
export class StaticRateProvider implements RateProvider {
  readonly name = 'static-fallback';

  private static readonly USD_PRICES: Record<string, string> = {
    USD: '1',
    EUR: '1.08',
    IDR: '0.000065',
    BTC: '65000',
    ETH: '3500',
  };

  async getUsdPrices(): Promise<Map<string, Decimal>> {
    const prices = new Map<string, Decimal>();
    for (const [code, price] of Object.entries(StaticRateProvider.USD_PRICES)) {
      prices.set(code, new Decimal(price));
    }
    return Promise.resolve(prices);
  }
}
