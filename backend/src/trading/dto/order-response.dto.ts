import { ApiProperty } from '@nestjs/swagger';
import { OrderSide } from '../entities/order-side.enum';
import { OrderStatus } from '../entities/order-status.enum';
import { OrderType } from '../entities/order-type.enum';

export class OrderResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'BTC/USD' })
  pair!: string;

  @ApiProperty({ enum: OrderSide, example: OrderSide.BUY })
  side!: OrderSide;

  @ApiProperty({ enum: OrderType, example: OrderType.MARKET })
  type!: OrderType;

  @ApiProperty({ example: '0.01' })
  quantity!: string;

  @ApiProperty({ example: '50000.00', nullable: true, description: 'null for market orders' })
  limitPrice!: string | null;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.FILLED })
  status!: OrderStatus;

  @ApiProperty({
    nullable: true,
    description: 'Ledger entry id for the hold placed on a limit order',
  })
  holdEntryId!: string | null;

  @ApiProperty({ nullable: true, description: 'Ledger entry id for the swap once filled' })
  fillEntryId!: string | null;

  @ApiProperty({ nullable: true, example: '62938.00' })
  filledPrice!: string | null;

  @ApiProperty({ nullable: true })
  filledAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}
