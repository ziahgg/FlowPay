import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [LedgerModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
