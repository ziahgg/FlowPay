import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeExecutionModule } from '../common/trade-execution/trade-execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RatesModule } from '../rates/rates.module';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersWorkerService } from './orders-worker.service';

@Module({
  imports: [LedgerModule, RatesModule, TradeExecutionModule, TypeOrmModule.forFeature([Order])],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersWorkerService],
})
export class TradingModule {}
