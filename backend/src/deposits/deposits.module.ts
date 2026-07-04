import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

@Module({
  imports: [LedgerModule],
  controllers: [DepositsController],
  providers: [DepositsService],
})
export class DepositsModule {}
