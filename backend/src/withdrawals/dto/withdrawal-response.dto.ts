import { WithdrawalRequestStatus } from '../entities/withdrawal-request-status.enum';

export class WithdrawalResponseDto {
  id!: string;
  currency!: string;
  amount!: string;
  destination!: string;
  status!: WithdrawalRequestStatus;
  holdEntryId!: string;
  settleEntryId!: string | null;
  decidedBy!: string | null;
  decidedAt!: Date | null;
  createdAt!: Date;
}
