import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { AccountBalance } from './entities/account-balance.entity';
import { Currency } from './entities/currency.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { LedgerService } from './ledger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Currency, Account, JournalEntry, JournalLine, AccountBalance]),
  ],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
