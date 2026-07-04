import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AccountsService } from './accounts.service';
import { AccountBalanceDto } from './dto/account-balance.dto';
import { TransactionLineDto } from './dto/transaction-line.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  async getBalances(@CurrentUser() user: AuthenticatedUser): Promise<AccountBalanceDto[]> {
    return this.accountsService.getBalances(user.id);
  }

  @Get(':currency/transactions')
  async getTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('currency') currency: string,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<TransactionLineDto>> {
    return this.accountsService.getTransactions(user.id, currency, pagination);
  }
}
