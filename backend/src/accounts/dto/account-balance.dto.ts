import { ApiProperty } from '@nestjs/swagger';

export class AccountBalanceDto {
  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '1250.00000000', description: 'Decimal string, never a JS number' })
  balance!: string;

  @ApiProperty({ example: 2, description: "The currency's native decimal precision" })
  decimals!: number;
}
