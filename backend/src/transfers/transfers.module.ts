import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { OutboxModule } from '../common/outbox/outbox.module';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [LedgerModule, UsersModule, IdempotencyModule, OutboxModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
