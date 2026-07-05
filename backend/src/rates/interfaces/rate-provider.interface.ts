import Decimal from 'decimal.js';

/**
 * A rate provider returns the price of every supported currency expressed in USD (the app's fixed
 * anchor currency -- see RatesService). USD itself is always 1. Any from/to rate is derived as
 * usdPrices[from] / usdPrices[to].
 */
export interface RateProvider {
  readonly name: string;
  getUsdPrices(): Promise<Map<string, Decimal>>;
}
