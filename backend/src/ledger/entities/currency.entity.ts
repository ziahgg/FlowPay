import { Column, Entity, PrimaryColumn } from 'typeorm';
import { CurrencyType } from './currency-type.enum';

@Entity('currencies')
export class Currency {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'enum', enum: CurrencyType, enumName: 'currency_type_enum' })
  type!: CurrencyType;

  @Column({ type: 'smallint' })
  decimals!: number;
}
