import { Module } from '@nestjs/common';
import { LedgerModule } from '../../ledger/ledger.module';
import { TradeExecutionService } from './trade-execution.service';

@Module({
  imports: [LedgerModule],
  providers: [TradeExecutionService],
  exports: [TradeExecutionService],
})
export class TradeExecutionModule {}
