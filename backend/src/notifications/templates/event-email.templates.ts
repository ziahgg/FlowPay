import { DomainEventType } from '../../common/outbox/domain-event-type.enum';

export interface RenderedEmail {
  subject: string;
  text: string;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : (value?.toString() ?? fallback);
}

/**
 * One plain-text template per event type -- no templating engine dependency for something this
 * simple. Returns null for an event type this module doesn't know how to render (defensive; every
 * type the outbox producers emit is covered below). Payload values are `unknown` (they arrive as
 * parsed JSON from Kafka), so every interpolation goes through `str()` rather than trusting them.
 */
export function renderEmail(
  eventType: string,
  payload: Record<string, unknown>,
): RenderedEmail | null {
  switch (eventType as DomainEventType) {
    case DomainEventType.DEPOSIT_COMPLETED:
      return {
        subject: 'Deposit received',
        text: `You deposited ${str(payload.amount)} ${str(payload.currency)}. It's now available in your FlowPay wallet.`,
      };

    case DomainEventType.TRANSFER_COMPLETED: {
      const note = payload.note ? ` Note: "${str(payload.note)}"` : '';
      return {
        subject: 'You received a transfer',
        text: `You received ${str(payload.amount)} ${str(payload.currency)} from ${str(payload.senderEmail, 'another FlowPay user')}.${note}`,
      };
    }

    case DomainEventType.WITHDRAWAL_APPROVED:
      return {
        subject: 'Withdrawal approved',
        text: `Your withdrawal of ${str(payload.amount)} ${str(payload.currency)} to ${str(payload.destination)} has been approved and settled.`,
      };

    case DomainEventType.WITHDRAWAL_REJECTED:
      return {
        subject: 'Withdrawal rejected',
        text: `Your withdrawal request of ${str(payload.amount)} ${str(payload.currency)} to ${str(payload.destination)} was rejected. The held funds have been returned to your wallet.`,
      };

    case DomainEventType.FX_CONVERTED:
      return {
        subject: 'Currency conversion complete',
        text: `You converted ${str(payload.amount)} ${str(payload.from)} to ${str(payload.toAmount)} ${str(payload.to)} at a rate of ${str(payload.rate)}.`,
      };

    case DomainEventType.ORDER_FILLED: {
      const [base, quote] = str(payload.pair).split('/');
      return {
        subject: 'Order filled',
        text: `Your ${str(payload.side)} order for ${str(payload.quantity)} ${base ?? ''} filled at ${str(payload.filledPrice)} ${quote ?? ''} per unit.`,
      };
    }

    default:
      return null;
  }
}
