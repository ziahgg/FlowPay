import { Module } from '@nestjs/common';
import { OutboxModule } from '../common/outbox/outbox.module';
import { LedgerModule } from '../ledger/ledger.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  imports: [LedgerModule, OutboxModule],
  controllers: [DepositsController],
  providers: [DepositsService],
})
export class DepositsModule {}
