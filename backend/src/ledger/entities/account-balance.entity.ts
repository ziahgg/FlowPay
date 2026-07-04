import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('account_balances')
export class AccountBalance {
  @PrimaryColumn({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @Column({ type: 'numeric', precision: 30, scale: 8, default: 0 })
  balance!: string;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
