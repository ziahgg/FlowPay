import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { JournalEntry } from './journal-entry.entity';
import { JournalLineDirection } from './journal-line-direction.enum';

@Entity('journal_lines')
@Index('IDX_journal_lines_account_created', ['accountId', 'createdAt'])
export class JournalLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'entry_id' })
  entryId!: string;

  @ManyToOne(() => JournalEntry)
  @JoinColumn({ name: 'entry_id' })
  entry!: JournalEntry;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ type: 'enum', enum: JournalLineDirection, enumName: 'journal_line_direction_enum' })
  direction!: JournalLineDirection;

  @Column({ type: 'numeric', precision: 30, scale: 8 })
  amount!: string;

  @Column({ type: 'varchar', length: 10, name: 'currency_code' })
  currencyCode!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
