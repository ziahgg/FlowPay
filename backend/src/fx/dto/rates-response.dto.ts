import { ApiProperty } from '@nestjs/swagger';

export class RatesResponseDto {
  @ApiProperty({
    example: 'USD',
    description: 'Fixed anchor currency all prices are quoted against',
  })
  base!: string;

  @ApiProperty({ description: 'ISO timestamp the underlying snapshot was fetched' })
  asOf!: string;

  @ApiProperty({ example: 'coingecko', enum: ['coingecko', 'static-fallback'] })
  source!: string;

  @ApiProperty({
    example: { USD: '1', BTC: '62938.00', EUR: '1.09' },
    description: 'USD price of each supported currency',
  })
  prices!: Record<string, string>;

  @ApiProperty({
    example: { USD: { BTC: '0.00001589' }, BTC: { USD: '62938.00' } },
    description: 'Every currency pair rate, derived from prices',
  })
  matrix!: Record<string, Record<string, string>>;
}
