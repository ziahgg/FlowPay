// TypeScript interfaces erase at runtime, so Nest needs an explicit token to inject "whatever
// implements EventProducer/EventConsumer" rather than a concrete class -- this is what lets
// OutboxPublisherService and the notifications consumer depend on the interface, not on kafkajs.
export const EVENT_PRODUCER = Symbol('EVENT_PRODUCER');
export const EVENT_CONSUMER = Symbol('EVENT_CONSUMER');
