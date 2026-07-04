import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { IdempotencyKeyStatus } from './idempotency-key-status.enum';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key!: string;

  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint!: string;

  @Column({ type: 'varchar', length: 64, name: 'request_hash' })
  requestHash!: string;

  @Column({
    type: 'enum',
    enum: IdempotencyKeyStatus,
    enumName: 'idempotency_key_status_enum',
    default: IdempotencyKeyStatus.PROCESSING,
  })
  status!: IdempotencyKeyStatus;

  @Column({ type: 'jsonb', name: 'response_body', nullable: true })
  responseBody!: Record<string, unknown> | null;

  @Column({ type: 'uuid', name: 'entry_id', nullable: true })
  entryId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
