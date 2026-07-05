import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, IsNull, Repository } from 'typeorm';
import { EVENT_PRODUCER } from '../kafka/kafka.tokens';
import { EventProducer } from '../kafka/interfaces/event-producer.interface';
import { OutboxEvent } from './entities/outbox-event.entity';

const BATCH_SIZE = 100;

/**
 * Polls unpublished outbox rows and publishes them to Kafka. This is what turns the atomically-
 * committed outbox row into an actual message -- and it is the exact place "at-least-once, never
 * lost, never phantom" comes from: each row is published inside its OWN transaction (lock row,
 * send to Kafka, mark published_at, commit). If the process crashes after the Kafka send succeeds
 * but before the commit, the row is still unpublished and gets retried on the next tick --
 * duplicate delivery is possible (hence the notifications consumer's idempotency check), but an
 * event can never be silently lost, and a row that never committed in the first place was never a
 * real event to begin with. See README "Event-driven architecture: the transactional outbox".
 *
 * One transaction per row, not one per batch: a Kafka failure on row N must not force re-sending
 * rows 1..N-1 that already committed successfully.
 */
@Injectable()
export class OutboxPublisherService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OutboxEvent) private readonly outboxRepository: Repository<OutboxEvent>,
    @Inject(EVENT_PRODUCER) private readonly eventProducer: EventProducer,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxPublisherService.name);
  }

  @Cron('*/5 * * * * *')
  async publishBatch(): Promise<number> {
    const candidates = await this.outboxRepository.find({
      where: { publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: BATCH_SIZE,
    });

    let publishedCount = 0;
    for (const candidate of candidates) {
      try {
        const published = await this.publishOne(candidate.id);
        if (published) {
          publishedCount++;
        }
      } catch (error) {
        this.logger.error(
          { err: error, outboxEventId: candidate.id },
          'Failed to publish outbox event',
        );
      }
    }

    return publishedCount;
  }

  private async publishOne(id: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(OutboxEvent, {
        where: { id, publishedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (!row) {
        // Already published (e.g. by a concurrent publisher instance) since the batch was read.
        return false;
      }

      await this.eventProducer.send({
        topic: row.topic,
        key: row.aggregateId,
        value: JSON.stringify({
          id: row.id,
          eventType: row.eventType,
          aggregateId: row.aggregateId,
          payload: row.payload,
          createdAt: row.createdAt.toISOString(),
        }),
      });

      row.publishedAt = new Date();
      await manager.save(row);
      return true;
    });
  }
}
