import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { PinoLogger } from 'nestjs-pino';
import { EnvConfig } from '../common/config/env.schema';
import { CoinGeckoRateProvider } from './providers/coingecko-rate.provider';
import { StaticRateProvider } from './providers/static-rate.provider';
import { RatesService } from './rates.service';

describe('RatesService', () => {
  let liveProvider: jest.Mocked<Pick<CoinGeckoRateProvider, 'name' | 'getUsdPrices'>>;
  let staticProvider: jest.Mocked<Pick<StaticRateProvider, 'name' | 'getUsdPrices'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let logger: jest.Mocked<Pick<PinoLogger, 'setContext' | 'warn'>>;
  let service: RatesService;

  const livePrices = new Map<string, Decimal>([
    ['USD', new Decimal(1)],
    ['BTC', new Decimal(65000)],
  ]);
  const staticPrices = new Map<string, Decimal>([
    ['USD', new Decimal(1)],
    ['BTC', new Decimal(60000)],
  ]);

  beforeEach(() => {
    liveProvider = {
      name: 'coingecko',
      getUsdPrices: jest.fn().mockResolvedValue(livePrices),
    } as unknown as jest.Mocked<Pick<CoinGeckoRateProvider, 'name' | 'getUsdPrices'>>;

    staticProvider = {
      name: 'static-fallback',
      getUsdPrices: jest.fn().mockResolvedValue(staticPrices),
    } as unknown as jest.Mocked<Pick<StaticRateProvider, 'name' | 'getUsdPrices'>>;

    configService = {
      get: jest.fn().mockReturnValue(30_000),
    };

    logger = { setContext: jest.fn(), warn: jest.fn() };

    service = new RatesService(
      liveProvider as unknown as CoinGeckoRateProvider,
      staticProvider,
      configService as unknown as ConfigService<EnvConfig, true>,
      logger as unknown as PinoLogger,
    );
  });

  it('uses the live provider when it succeeds', async () => {
    const snapshot = await service.getSnapshot();

    expect(snapshot.source).toBe('coingecko');
    expect(snapshot.prices.get('BTC')).toEqual(new Decimal(65000));
    expect(staticProvider.getUsdPrices).not.toHaveBeenCalled();
  });

  it('falls back to the static provider and logs a warning when the live provider fails', async () => {
    liveProvider.getUsdPrices.mockRejectedValue(new Error('network down'));

    const snapshot = await service.getSnapshot();

    expect(snapshot.source).toBe('static-fallback');
    expect(snapshot.prices.get('BTC')).toEqual(new Decimal(60000));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('serves cached prices within the TTL without refetching', async () => {
    await service.getSnapshot();
    await service.getSnapshot();

    expect(liveProvider.getUsdPrices).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache has expired', async () => {
    configService.get.mockReturnValue(0);

    await service.getSnapshot();
    await service.getSnapshot();

    expect(liveProvider.getUsdPrices).toHaveBeenCalledTimes(2);
  });

  it('derives a pair rate as fromPrice / toPrice', async () => {
    const { rate, source } = await service.getRate('BTC', 'USD');

    expect(rate).toEqual(new Decimal(65000));
    expect(source).toBe('coingecko');
  });

  it('throws NotFoundException for an unknown currency', async () => {
    await expect(service.getRate('BTC', 'ZZZ')).rejects.toThrow(
      'No exchange rate available for BTC/ZZZ from the current rate provider',
    );
  });
});
