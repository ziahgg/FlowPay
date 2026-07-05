import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka } from 'kafkajs';
import { PinoLogger } from 'nestjs-pino';
import { EnvConfig } from '../config/env.schema';
import { EventConsumer, SubscribeParams } from './interfaces/event-consumer.interface';

@Injectable()
export class KafkaEventConsumer implements EventConsumer, OnModuleDestroy {
  private readonly kafka: Kafka;
  private consumer: Consumer | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    configService: ConfigService<EnvConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.kafka = new Kafka({
      clientId: configService.get('KAFKA_CLIENT_ID', { infer: true }),
      brokers: configService.get('KAFKA_BROKERS', { infer: true }).split(','),
      // The CRASH handler in runConsumer() below is the single retry/backoff strategy for a
      // consumer that dies mid-run -- see the matching comment in kafka-event-producer.ts for why
      // kafkajs's own internal retry must be disabled here too. One side effect: kafkajs's default
      // auto-restart-on-crash also relies on that same internal retry bookkeeping, so disabling it
      // silently disables auto-restart too -- runConsumer()'s own CRASH listener replaces it.
      retry: { retries: 0 },
    });
    this.logger.setContext(KafkaEventConsumer.name);
  }

  async subscribe(params: SubscribeParams): Promise<void> {
    await this.runConsumer(params, 1);
  }

  private async runConsumer(params: SubscribeParams, attempt: number): Promise<void> {
    const consumer = this.kafka.consumer({ groupId: params.groupId });
    this.consumer = consumer;

    consumer.on(consumer.events.CRASH, ({ payload }) => {
      if (this.destroyed) return;
      const retryInMs = Math.min(30_000, 1_000 * attempt);
      this.logger.error(
        { err: payload.error, groupId: params.groupId, retryInMs },
        'Kafka consumer crashed; resubscribing',
      );
      this.retryTimer = setTimeout(() => {
        this.runConsumer(params, attempt + 1).catch((error: unknown) => {
          this.logger.error({ err: error }, 'Failed to resubscribe after a consumer crash');
        });
      }, retryInMs);
    });

    await consumer.connect();
    await consumer.subscribe({ topic: params.topic, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        await params.onMessage({
          key: message.key?.toString() ?? null,
          value: message.value?.toString() ?? '',
        });
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    await this.consumer?.disconnect();
  }
}
