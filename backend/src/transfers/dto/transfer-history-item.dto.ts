import { ApiProperty } from '@nestjs/swagger';

export class TransferHistoryItemDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  entryId!: string;

  @ApiProperty({ enum: ['sent', 'received'], example: 'sent' })
  direction!: 'sent' | 'received';

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '25.00' })
  amount!: string;

  @ApiProperty({ example: 'bob@example.com', nullable: true })
  counterpartyEmail!: string | null;

  @ApiProperty({ example: 'Happy birthday!', nullable: true })
  note!: string | null;

  @ApiProperty()
  createdAt!: Date;
}
