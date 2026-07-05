import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { PinoLogger } from 'nestjs-pino';
import { EnvConfig } from '../common/config/env.schema';
import { CoinGeckoRateProvider } from './providers/coingecko-rate.provider';
import { StaticRateProvider } from './providers/static-rate.provider';

export interface RateSnapshot {
  prices: Map<string, Decimal>;
  source: string;
  asOf: Date;
}

/**
 * Caches USD-anchored prices for ~RATE_CACHE_TTL_MS, refetching from the live provider on expiry.
 * If the live provider fails for any reason (network, timeout, malformed response), falls back to
 * the static provider and logs a warning -- resilience is the point, the app must keep working
 * offline. A cached snapshot (live or static) is served for its full TTL regardless of which
 * provider produced it; a fresh attempt at the live provider is only made once the cache expires.
 */
@Injectable()
export class RatesService {
  private cache: RateSnapshot | null = null;

  constructor(
    private readonly liveProvider: CoinGeckoRateProvider,
    private readonly staticProvider: StaticRateProvider,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RatesService.name);
  }

  async getSnapshot(): Promise<RateSnapshot> {
    const ttlMs = this.configService.get('RATE_CACHE_TTL_MS', { infer: true });

    if (this.cache && Date.now() - this.cache.asOf.getTime() < ttlMs) {
      return this.cache;
    }

    try {
      const prices = await this.liveProvider.getUsdPrices();
      this.cache = { prices, source: this.liveProvider.name, asOf: new Date() };
    } catch (error) {
      this.logger.warn(
        { err: error },
        `Live rate provider "${this.liveProvider.name}" failed; falling back to static rates`,
      );
      const prices = await this.staticProvider.getUsdPrices();
      this.cache = { prices, source: this.staticProvider.name, asOf: new Date() };
    }

    return this.cache;
  }

  async getRate(from: string, to: string): Promise<{ rate: Decimal; source: string; asOf: Date }> {
    const snapshot = await this.getSnapshot();

    const fromPrice = snapshot.prices.get(from);
    const toPrice = snapshot.prices.get(to);
    if (!fromPrice || !toPrice) {
      throw new NotFoundException(
        `No exchange rate available for ${from}/${to} from the current rate provider`,
      );
    }

    return { rate: fromPrice.dividedBy(toPrice), source: snapshot.source, asOf: snapshot.asOf };
  }

  getCacheTtlMs(): number {
    return this.configService.get('RATE_CACHE_TTL_MS', { infer: true });
  }
}
