import { ApiProperty } from '@nestjs/swagger';

export class TransferResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  entryId!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '25.00' })
  amount!: string;

  @ApiProperty({
    example: '75.00000000',
    description: "Sender's wallet balance after the transfer",
  })
  balance!: string;
}
