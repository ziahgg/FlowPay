import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { DepositsModule } from './deposits/deposits.module';
import { FxModule } from './fx/fx.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { RatesModule } from './rates/rates.module';
import { TransfersModule } from './transfers/transfers.module';
import { UsersModule } from './users/users.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
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
  ],
})
export class AppModule {}
