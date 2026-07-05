import { Module } from '@nestjs/common';
import { CoinGeckoRateProvider } from './providers/coingecko-rate.provider';
import { StaticRateProvider } from './providers/static-rate.provider';
import { RatesService } from './rates.service';

@Module({
  providers: [CoinGeckoRateProvider, StaticRateProvider, RatesService],
  exports: [RatesService],
})
export class RatesModule {}
