export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'open' | 'filled' | 'cancelled';

export interface CreateOrderRequest {
  pair: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  limitPrice?: string;
}

export interface OrderResponse {
  id: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  limitPrice: string | null;
  status: OrderStatus;
  holdEntryId: string | null;
  fillEntryId: string | null;
  filledPrice: string | null;
  filledAt: string | null;
  createdAt: string;
}
