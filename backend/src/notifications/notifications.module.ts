import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KafkaModule } from '../common/kafka/kafka.module';
import { ProcessedEvent } from './entities/processed-event.entity';
import { MailerService } from './mailer.service';
import { NotificationsConsumerService } from './notifications-consumer.service';

// Deliberately does NOT import LedgerModule, UsersModule, or any other domain module -- see
// NotificationsConsumerService for why that boundary is the point of this module.
@Module({
  imports: [KafkaModule, TypeOrmModule.forFeature([ProcessedEvent])],
  providers: [MailerService, NotificationsConsumerService],
})
export class NotificationsModule {}
