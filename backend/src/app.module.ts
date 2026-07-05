import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { DepositsModule } from './deposits/deposits.module';
import { FxModule } from './fx/fx.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { RatesModule } from './rates/rates.module';
import { TradingModule } from './trading/trading.module';
import { TransfersModule } from './transfers/transfers.module';
import { UsersModule } from './users/users.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    ScheduleModule.forRoot(),
    HealthModule,
    UsersModule,
    AuthModule,
    LedgerModule,
    AccountsModule,
    DepositsModule,
    WithdrawalsModule,
    TransfersModule,
    RatesModule,
    FxModule,
    TradingModule,
  ],
})
export class AppModule {}
