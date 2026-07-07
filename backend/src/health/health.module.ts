import { Module } from '@nestjs/common';
import { KafkaModule } from '../common/kafka/kafka.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [KafkaModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
