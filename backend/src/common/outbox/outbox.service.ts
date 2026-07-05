import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FLOWPAY_EVENTS_TOPIC } from './domain-event-type.enum';
import { OutboxEvent } from './entities/outbox-event.entity';
import { AppendEventInput } from './interfaces/append-event.interface';

/**
 * The only write path for outbox_events (mirrors the ledger's "one write path" rule). `manager` is
 * a *required* parameter, not optional -- appending an event only ever makes sense atomically with
 * the domain write it describes, so the type signature makes it structurally impossible to call
 * this outside of the caller's own transaction by accident. See README "Event-driven architecture"
 * for why that atomicity is the entire point of the outbox pattern.
 */
@Injectable()
export class OutboxService {
  async append(event: AppendEventInput, manager: EntityManager): Promise<void> {
    const repository = manager.getRepository(OutboxEvent);
    await repository.save(
      repository.create({
        topic: event.topic ?? FLOWPAY_EVENTS_TOPIC,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        payload: event.payload,
      }),
    );
  }
}
