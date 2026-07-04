import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WithdrawalRequestStatus } from './withdrawal-request-status.enum';

@Entity('withdrawal_requests')
export class WithdrawalRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_withdrawal_requests_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 10, name: 'currency_code' })
  currencyCode!: string;

  @Column({ type: 'numeric', precision: 30, scale: 8 })
  amount!: string;

  @Column({ type: 'varchar', length: 255 })
  destination!: string;

  @Index('IDX_withdrawal_requests_status')
  @Column({
    type: 'enum',
    enum: WithdrawalRequestStatus,
    enumName: 'withdrawal_request_status_enum',
    default: WithdrawalRequestStatus.PENDING,
  })
  status!: WithdrawalRequestStatus;

  @Column({ type: 'uuid', name: 'decided_by', nullable: true })
  decidedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'uuid', name: 'hold_entry_id' })
  holdEntryId!: string;

  // Reused for whichever entry resolved the hold: the settle entry on approval, or the release
  // entry on rejection (see the withdrawal_requests migration -- there is no separate column).
  @Column({ type: 'uuid', name: 'settle_entry_id', nullable: true })
  settleEntryId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
