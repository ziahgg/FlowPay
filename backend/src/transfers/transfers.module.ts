import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [LedgerModule, UsersModule, IdempotencyModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
