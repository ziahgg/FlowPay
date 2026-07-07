import { ApiProperty } from '@nestjs/swagger';

export class QuoteResponseDto {
  @ApiProperty({ example: 'USD' })
  from!: string;

  @ApiProperty({ example: 'BTC' })
  to!: string;

  @ApiProperty({ example: '100.00' })
  amount!: string;

  @ApiProperty({ example: '0.00159300', description: 'Raw mid-market rate, before spread' })
  rate!: string;

  @ApiProperty({ example: 50, description: 'FX_SPREAD_BPS applied to the raw rate' })
  spreadBps!: number;

  @ApiProperty({ example: '0.00159221', description: 'Rate actually used, after spread' })
  netRate!: string;

  @ApiProperty({ example: '0.00159221', description: 'Amount the user would receive' })
  toAmount!: string;

  @ApiProperty({ description: 'ISO timestamp this quote is valid until' })
  quoteExpiresAt!: string;

  @ApiProperty({ example: 'coingecko', enum: ['coingecko', 'static-fallback'] })
  source!: string;
}
