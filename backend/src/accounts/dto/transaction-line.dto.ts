import { ApiProperty } from '@nestjs/swagger';

export class TransactionLineDto {
  @ApiProperty({ example: 'deposit', description: 'The journal entry type' })
  type!: string;

  @ApiProperty({ example: 'credit', enum: ['debit', 'credit'] })
  direction!: string;

  @ApiProperty({ example: '100.00000000' })
  amount!: string;

  @ApiProperty({ example: 'Simulated deposit of 100.00 USD', nullable: true })
  description!: string | null;

  @ApiProperty()
  createdAt!: Date;
}
