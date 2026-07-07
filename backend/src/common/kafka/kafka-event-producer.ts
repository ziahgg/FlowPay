import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { PinoLogger } from 'nestjs-pino';
import { EnvConfig } from '../config/env.schema';
import { EventMessage, EventProducer } from './interfaces/event-producer.interface';

@Injectable()
export class KafkaEventProducer implements EventProducer, OnModuleInit, OnModuleDestroy {
  private readonly producer: Producer;
  private retryTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private connected = false;

  constructor(
    configService: ConfigService<EnvConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    const kafka = new Kafka({
      clientId: configService.get('KAFKA_CLIENT_ID', { infer: true }),
      brokers: configService.get('KAFKA_BROKERS', { infer: true }).split(','),
      // connectWithRetry() below is the single retry/backoff strategy for a failed connection --
      // kafkajs's own internal retry (default: several attempts with exponential backoff) would
      // otherwise keep an unreachable-broker connection attempt in flight well past the point
      // connectWithRetry() already gave up and rescheduled, which is exactly what leaked timers
      // and unclosed sockets past test teardown before this was set.
      retry: { retries: 0 },
    });
    this.producer = kafka.producer();
    this.logger.setContext(KafkaEventProducer.name);

    // Tracks connection state across the producer's whole lifecycle (not just the initial
    // connect() attempt) so GET /health can report a broker that dropped mid-run too, not just one
    // that was never reachable at boot.
    this.producer.on(this.producer.events.CONNECT, () => {
      this.connected = true;
    });
    this.producer.on(this.producer.events.DISCONNECT, () => {
      this.connected = false;
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Fire-and-forget on purpose, mirroring NotificationsConsumerService: if Kafka isn't reachable
   * at boot, connect() would otherwise reject (after kafkajs's internal retries) and take the
   * whole app down with it via Nest's lifecycle hooks. `send()` naturally fails while
   * disconnected, and OutboxPublisherService already tolerates and logs a per-row send failure,
   * retrying on its next tick -- so a not-yet-connected producer is a transient condition, not a
   * crash.
   */
  onModuleInit(): void {
    this.connectWithRetry();
  }

  private connectWithRetry(attempt = 1): void {
    this.producer.connect().catch((error: unknown) => {
      if (this.destroyed) return;
      const retryInMs = Math.min(30_000, 1_000 * attempt);
      this.logger.error({ err: error, attempt, retryInMs }, 'Failed to connect to Kafka; retrying');
      this.retryTimer = setTimeout(() => this.connectWithRetry(attempt + 1), retryInMs);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    await this.producer.disconnect();
  }

  async send(message: EventMessage): Promise<void> {
    await this.producer.send({
      topic: message.topic,
      messages: [{ key: message.key, value: message.value }],
    });
  }
}
