import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('processed_events')
export class ProcessedEvent {
  @PrimaryColumn({ type: 'uuid', name: 'event_id' })
  eventId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'processed_at' })
  processedAt!: Date;
}
