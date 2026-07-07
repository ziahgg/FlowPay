import { ApiProperty } from '@nestjs/swagger';
import { WithdrawalRequestStatus } from '../entities/withdrawal-request-status.enum';

export class WithdrawalResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '50.00' })
  amount!: string;

  @ApiProperty({ example: 'IBAN GB29 NWBK 6016 1331 9268 19' })
  destination!: string;

  @ApiProperty({ enum: WithdrawalRequestStatus, example: WithdrawalRequestStatus.PENDING })
  status!: WithdrawalRequestStatus;

  @ApiProperty({ description: 'Ledger entry id for the hold placed when this request was created' })
  holdEntryId!: string;

  @ApiProperty({
    nullable: true,
    description: 'Ledger entry id for the settle (approved) or release (rejected) entry',
  })
  settleEntryId!: string | null;

  @ApiProperty({ nullable: true, description: 'Admin user id who approved/rejected this request' })
  decidedBy!: string | null;

  @ApiProperty({ nullable: true })
  decidedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}
