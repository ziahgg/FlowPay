import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxModule } from '../common/outbox/outbox.module';
import { TradeExecutionModule } from '../common/trade-execution/trade-execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RatesModule } from '../rates/rates.module';
import { UsersModule } from '../users/users.module';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersWorkerService } from './orders-worker.service';

@Module({
  imports: [
    LedgerModule,
    RatesModule,
    TradeExecutionModule,
    UsersModule,
    OutboxModule,
    TypeOrmModule.forFeature([Order]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersWorkerService],
})
export class TradingModule {}
