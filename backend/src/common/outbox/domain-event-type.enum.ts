export enum DomainEventType {
  TRANSFER_COMPLETED = 'transfer.completed',
  DEPOSIT_COMPLETED = 'deposit.completed',
  WITHDRAWAL_APPROVED = 'withdrawal.approved',
  WITHDRAWAL_REJECTED = 'withdrawal.rejected',
  FX_CONVERTED = 'fx.converted',
  ORDER_FILLED = 'order.filled',
}

// A single topic for every domain event type; the consumer branches on `eventType` inside the
// message rather than subscribing to N topics. Appropriate at this system's scale -- see README
// "Event-driven architecture" for the trade-off.
export const FLOWPAY_EVENTS_TOPIC = 'flowpay.events';
