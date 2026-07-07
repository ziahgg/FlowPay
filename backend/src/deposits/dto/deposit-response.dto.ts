import { ApiProperty } from '@nestjs/swagger';

export class DepositResponseDto {
  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '100.00' })
  amount!: string;

  @ApiProperty({ example: '1250.00000000', description: 'Wallet balance after the deposit' })
  balance!: string;
}
