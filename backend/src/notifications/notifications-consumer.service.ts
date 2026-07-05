import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { EnvConfig } from '../common/config/env.schema';
import {
  ConsumedEventMessage,
  EventConsumer,
} from '../common/kafka/interfaces/event-consumer.interface';
import { EVENT_CONSUMER } from '../common/kafka/kafka.tokens';
import { FLOWPAY_EVENTS_TOPIC } from '../common/outbox/domain-event-type.enum';
import { MailerService } from './mailer.service';
import { renderEmail } from './templates/event-email.templates';

interface OutboxEventMessage {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Consumes `flowpay.events` via Kafka ONLY -- no import of LedgerModule, UsersModule, or any other
 * domain module. This service touches exactly three things: Kafka, its own `processed_events`
 * table, and SMTP. That is the concrete proof this module could be extracted into its own
 * microservice tomorrow with no code changes beyond the deployment boundary (see README
 * "Event-driven architecture").
 *
 * Delivery from the outbox publisher is at-least-once, so every message is deduped against
 * `processed_events` before any side effect, using the exact same atomic
 * "INSERT ... ON CONFLICT DO NOTHING" claim idiom `IdempotencyService` uses for the same reason.
 */
@Injectable()
export class NotificationsConsumerService implements OnModuleInit, OnModuleDestroy {
  private retryTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    @Inject(EVENT_CONSUMER) private readonly eventConsumer: EventConsumer,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService<EnvConfig, true>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationsConsumerService.name);
  }

  /**
   * Fire-and-forget on purpose: if Kafka isn't reachable yet at boot (or the topic doesn't exist
   * the instant this subscribes -- a real race the first time this app ever starts against a
   * fresh broker), that must not crash the whole backend. Notifications are best-effort; retrying
   * with backoff here keeps every other feature working regardless of Kafka's availability.
   */
  onModuleInit(): void {
    this.subscribeWithRetry();
  }

  private subscribeWithRetry(attempt = 1): void {
    this.eventConsumer
      .subscribe({
        topic: FLOWPAY_EVENTS_TOPIC,
        groupId: this.configService.get('NOTIFICATIONS_CONSUMER_GROUP_ID', { infer: true }),
        onMessage: (message) => this.handleMessage(message),
      })
      .catch((error: unknown) => {
        if (this.destroyed) return;
        const retryInMs = Math.min(30_000, 1_000 * attempt);
        this.logger.error(
          { err: error, attempt, retryInMs },
          'Failed to subscribe to flowpay.events; retrying',
        );
        this.retryTimer = setTimeout(() => this.subscribeWithRetry(attempt + 1), retryInMs);
      });
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  async handleMessage(message: ConsumedEventMessage): Promise<void> {
    let event: OutboxEventMessage;
    try {
      event = JSON.parse(message.value) as OutboxEventMessage;
    } catch (error) {
      this.logger.error(
        { err: error, raw: message.value },
        'Received an unparseable event message',
      );
      return;
    }

    const claimed = await this.claim(event.id);
    if (!claimed) {
      // Already processed -- expected under at-least-once delivery, not an error.
      return;
    }

    const email = renderEmail(event.eventType, event.payload);
    if (!email) {
      this.logger.warn({ eventType: event.eventType }, 'No email template for this event type');
      return;
    }

    const recipientEmail = event.payload.recipientEmail as string | null | undefined;
    if (!recipientEmail) {
      this.logger.warn(
        { eventId: event.id, eventType: event.eventType },
        'Event has no recipientEmail; skipping notification',
      );
      return;
    }

    await this.mailerService.send({ to: recipientEmail, subject: email.subject, text: email.text });
  }

  private async claim(eventId: string): Promise<boolean> {
    const inserted = await this.dataSource.query<{ event_id: string }[]>(
      `INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId],
    );
    return inserted.length > 0;
  }
}
