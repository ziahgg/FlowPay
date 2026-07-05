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
  exports: [EVENT_PRODUCER, EVENT_CONSUMER],
})
export class KafkaModule {}
