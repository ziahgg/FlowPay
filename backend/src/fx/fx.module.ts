import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { OutboxModule } from '../common/outbox/outbox.module';
import { TradeExecutionModule } from '../common/trade-execution/trade-execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RatesModule } from '../rates/rates.module';
import { UsersModule } from '../users/users.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  imports: [
    LedgerModule,
    RatesModule,
    IdempotencyModule,
    TradeExecutionModule,
    UsersModule,
    OutboxModule,
  ],
  controllers: [FxController],
  providers: [FxService],
})
export class FxModule {}
