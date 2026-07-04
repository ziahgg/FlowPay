import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerModule } from '../ledger/ledger.module';
import { AdminWithdrawalsController } from './admin-withdrawals.controller';
import { WithdrawalRequest } from './entities/withdrawal-request.entity';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [LedgerModule, TypeOrmModule.forFeature([WithdrawalRequest])],
  controllers: [WithdrawalsController, AdminWithdrawalsController],
  providers: [WithdrawalsService],
})
export class WithdrawalsModule {}
