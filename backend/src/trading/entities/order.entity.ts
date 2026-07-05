import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { OrderSide } from './order-side.enum';
import { OrderStatus } from './order-status.enum';
import { OrderType } from './order-type.enum';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_orders_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  // e.g. 'BTC/USD' -- base/quote, validated against known currencies at request time (no separate
  // trading-pairs table; see README "Trading quickstart" for the simplification).
  @Column({ type: 'varchar', length: 21 })
  pair!: string;

  @Column({ type: 'enum', enum: OrderSide, enumName: 'order_side_enum' })
  side!: OrderSide;

  @Column({ type: 'enum', enum: OrderType, enumName: 'order_type_enum' })
  type!: OrderType;

  @Column({ type: 'numeric', precision: 30, scale: 8 })
  quantity!: string;

  @Column({ type: 'numeric', precision: 30, scale: 8, name: 'limit_price', nullable: true })
  limitPrice!: string | null;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status_enum',
    default: OrderStatus.OPEN,
  })
  status!: OrderStatus;

  @Column({ type: 'uuid', name: 'hold_entry_id', nullable: true })
  holdEntryId!: string | null;

  @Column({ type: 'uuid', name: 'fill_entry_id', nullable: true })
  fillEntryId!: string | null;

  @Column({ type: 'numeric', precision: 30, scale: 8, name: 'filled_price', nullable: true })
  filledPrice!: string | null;

  @Column({ type: 'timestamptz', name: 'filled_at', nullable: true })
  filledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
