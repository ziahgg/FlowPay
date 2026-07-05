import { DomainEventType } from '../domain-event-type.enum';

export interface AppendEventInput {
  eventType: DomainEventType;
  aggregateId: string;
  payload: Record<string, unknown>;
  topic?: string;
}
