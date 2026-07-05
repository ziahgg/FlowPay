export interface EventMessage {
  topic: string;
  key: string;
  value: string;
}

/**
 * Hides Kafka (or any broker) behind a two-method surface so the outbox publisher's logic --
 * batching, per-row transactions, at-least-once semantics -- is testable with an in-memory fake
 * instead of a real broker. See README "Event-driven architecture" for why this project tests the
 * outbox pattern this way rather than via Testcontainers Kafka.
 */
export interface EventProducer {
  send(message: EventMessage): Promise<void>;
}
