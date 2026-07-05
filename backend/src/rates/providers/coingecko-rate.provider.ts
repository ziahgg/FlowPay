import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { RateProvider } from '../interfaces/rate-provider.interface';

interface CoinGeckoSimplePriceResponse {
  [coinId: string]: { [vsCurrency: string]: number } | undefined;
}

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Fetches BTC/ETH prices in USD, EUR and IDR from CoinGecko's public `simple/price` endpoint (no
 * API key). CoinGecko only prices actual coins, not fiat-to-fiat pairs, so EUR/IDR's USD price is
 * derived by bridging through BTC: usdPrice(EUR) = usdPrice(BTC) / (BTC priced in EUR). This is
 * standard triangulation and only requires one HTTP call.
 *
 * Hardcoded to this app's fixed 5-currency universe (USD/EUR/IDR/BTC/ETH) rather than built as a
 * generic N-currency client -- there is no other currency in the system to generalize for.
 */
@Injectable()
export class CoinGeckoRateProvider implements RateProvider {
  readonly name = 'coingecko';

  private readonly baseUrl = 'https://api.coingecko.com/api/v3/simple/price';

  async getUsdPrices(): Promise<Map<string, Decimal>> {
    const url = `${this.baseUrl}?ids=bitcoin,ethereum&vs_currencies=usd,eur,idr`;

    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`CoinGecko responded with status ${response.status}`);
    }

    const data = (await response.json()) as CoinGeckoSimplePriceResponse;
    const btcUsd = data.bitcoin?.usd;
    const btcEur = data.bitcoin?.eur;
    const btcIdr = data.bitcoin?.idr;
    const ethUsd = data.ethereum?.usd;

    if (btcUsd == null || btcEur == null || btcIdr == null || ethUsd == null) {
      throw new Error('CoinGecko response is missing expected price fields');
    }

    const btcUsdPrice = new Decimal(btcUsd);

    const prices = new Map<string, Decimal>();
    prices.set('USD', new Decimal(1));
    prices.set('EUR', btcUsdPrice.dividedBy(new Decimal(btcEur)));
    prices.set('IDR', btcUsdPrice.dividedBy(new Decimal(btcIdr)));
    prices.set('BTC', btcUsdPrice);
    prices.set('ETH', new Decimal(ethUsd));

    return prices;
  }
}
