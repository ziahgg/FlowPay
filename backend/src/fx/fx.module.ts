import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RatesModule } from '../rates/rates.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  imports: [LedgerModule, RatesModule, IdempotencyModule],
  controllers: [FxController],
  providers: [FxService],
})
export class FxModule {}
