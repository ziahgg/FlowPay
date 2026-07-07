import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, Matches, ValidateIf } from 'class-validator';
import { OrderSide } from '../entities/order-side.enum';
import { OrderType } from '../entities/order-type.enum';

const AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;

export class CreateOrderDto {
  @ApiProperty({ example: 'BTC/USD', description: 'BASE/QUOTE, e.g. BTC/USD' })
  @IsString()
  @Matches(/^[A-Za-z]{2,10}\/[A-Za-z]{2,10}$/, {
    message: 'pair must be formatted as BASE/QUOTE, e.g. BTC/USD',
  })
  pair!: string;

  @ApiProperty({ enum: OrderSide, example: OrderSide.BUY })
  @IsEnum(OrderSide)
  side!: OrderSide;

  @ApiProperty({ enum: OrderType, example: OrderType.MARKET })
  @IsEnum(OrderType)
  type!: OrderType;

  @ApiProperty({ example: '0.01', description: 'Positive decimal string, up to 8 decimal places' })
  @IsString()
  @Matches(AMOUNT_PATTERN, {
    message: 'quantity must be a positive decimal string with up to 8 decimal places',
  })
  quantity!: string;

  @ApiPropertyOptional({
    example: '50000.00',
    description: 'Required for limit orders, ignored for market orders',
  })
  // Required for limit orders, ignored for market orders (validated at the DB level too, via the
  // orders table's CHK_orders_limit_price_matches_type constraint).
  @ValidateIf((dto: CreateOrderDto) => dto.type === OrderType.LIMIT)
  @IsString()
  @Matches(AMOUNT_PATTERN, {
    message: 'limitPrice must be a positive decimal string with up to 8 decimal places',
  })
  limitPrice?: string;
}
