import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { KafkaEventProducer } from '../common/kafka/kafka-event-producer';

export interface HealthStatus {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  kafka: 'up' | 'down';
}

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly kafkaEventProducer: KafkaEventProducer,
  ) {}

  /**
   * Only Postgres being down flips `status` to 'error' (and the controller's HTTP status to 503).
   * Kafka is deliberately excluded from readiness -- per the resilience design in "Event-driven
   * architecture" (README), a temporarily unreachable broker degrades notifications only, not the
   * core API, so it shouldn't take a pod out of a load balancer's rotation. `kafka` is still
   * reported here for visibility into that degraded state.
   */
  async check(): Promise<HealthStatus> {
    const dbUp = await this.isDatabaseUp();
    const kafkaUp = this.kafkaEventProducer.isConnected();

    return {
      status: dbUp ? 'ok' : 'error',
      db: dbUp ? 'up' : 'down',
      kafka: kafkaUp ? 'up' : 'down',
    };
  }

  private async isDatabaseUp(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
