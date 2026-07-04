import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AccountKind } from './account-kind.enum';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'owner_user_id', nullable: true })
  ownerUserId!: string | null;

  @Column({ type: 'varchar', length: 10, name: 'currency_code' })
  currencyCode!: string;

  @Column({ type: 'enum', enum: AccountKind, enumName: 'account_kind_enum' })
  kind!: AccountKind;
}
