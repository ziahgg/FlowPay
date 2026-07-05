import { IsEnum, IsString, Matches, ValidateIf } from 'class-validator';
import { OrderSide } from '../entities/order-side.enum';
import { OrderType } from '../entities/order-type.enum';

const AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;

export class CreateOrderDto {
  @IsString()
  @Matches(/^[A-Za-z]{2,10}\/[A-Za-z]{2,10}$/, {
    message: 'pair must be formatted as BASE/QUOTE, e.g. BTC/USD',
  })
  pair!: string;

  @IsEnum(OrderSide)
  side!: OrderSide;

  @IsEnum(OrderType)
  type!: OrderType;

  @IsString()
  @Matches(AMOUNT_PATTERN, {
    message: 'quantity must be a positive decimal string with up to 8 decimal places',
  })
  quantity!: string;

  // Required for limit orders, ignored for market orders (validated at the DB level too, via the
  // orders table's CHK_orders_limit_price_matches_type constraint).
  @ValidateIf((dto: CreateOrderDto) => dto.type === OrderType.LIMIT)
  @IsString()
  @Matches(AMOUNT_PATTERN, {
    message: 'limitPrice must be a positive decimal string with up to 8 decimal places',
  })
  limitPrice?: string;
}
