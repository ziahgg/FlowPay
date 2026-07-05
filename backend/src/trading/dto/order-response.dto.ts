import { OrderSide } from '../entities/order-side.enum';
import { OrderStatus } from '../entities/order-status.enum';
import { OrderType } from '../entities/order-type.enum';

export class OrderResponseDto {
  id!: string;
  pair!: string;
  side!: OrderSide;
  type!: OrderType;
  quantity!: string;
  limitPrice!: string | null;
  status!: OrderStatus;
  holdEntryId!: string | null;
  fillEntryId!: string | null;
  filledPrice!: string | null;
  filledAt!: Date | null;
  createdAt!: Date;
}
