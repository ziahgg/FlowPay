import { ApiProperty } from '@nestjs/swagger';

export class ConvertResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  entryId!: string;

  @ApiProperty({ example: 'USD' })
  from!: string;

  @ApiProperty({ example: 'BTC' })
  to!: string;

  @ApiProperty({ example: '100.00' })
  amount!: string;

  @ApiProperty({ example: '0.00159221' })
  toAmount!: string;

  @ApiProperty({ example: '0.00159300', description: 'Raw mid-market rate, before spread' })
  rate!: string;

  @ApiProperty({ example: '0.00159221', description: 'Net rate actually executed, after spread' })
  netRate!: string;

  @ApiProperty({ example: 50 })
  spreadBps!: number;

  @ApiProperty({
    example: '75.00000000',
    description: 'Wallet balance in the from currency after conversion',
  })
  fromBalance!: string;

  @ApiProperty({
    example: '0.00159221',
    description: 'Wallet balance in the to currency after conversion',
  })
  toBalance!: string;
}
