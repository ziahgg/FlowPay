import { Module } from '@nestjs/common';
import { KafkaEventConsumer } from './kafka-event-consumer';
import { KafkaEventProducer } from './kafka-event-producer';
import { EVENT_CONSUMER, EVENT_PRODUCER } from './kafka.tokens';

@Module({
  providers: [
    KafkaEventProducer,
    KafkaEventConsumer,
    { provide: EVENT_PRODUCER, useExisting: KafkaEventProducer },
    { provide: EVENT_CONSUMER, useExisting: KafkaEventConsumer },
  ],
  // KafkaEventProducer itself is exported (alongside the interface tokens domain code should
  // prefer) specifically so HealthService can call its isConnected() -- a health check is
  // infrastructure-level, not a domain concern the EventProducer interface should carry.
  exports: [EVENT_PRODUCER, EVENT_CONSUMER, KafkaEventProducer],
})
export class KafkaModule {}
