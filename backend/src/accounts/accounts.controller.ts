import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { ProblemDetailsDto } from '../common/dto/problem-details.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AccountsService } from './accounts.service';
import { AccountBalanceDto } from './dto/account-balance.dto';
import { TransactionLineDto } from './dto/transaction-line.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @ApiOperation({ summary: "List the authenticated user's wallet balances, one per currency" })
  @ApiResponse({ status: 200, description: 'Balances', type: [AccountBalanceDto] })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @Get()
  async getBalances(@CurrentUser() user: AuthenticatedUser): Promise<AccountBalanceDto[]> {
    return this.accountsService.getBalances(user.id);
  }

  @ApiOperation({ summary: 'Paginated ledger transaction history for one currency' })
  @ApiParam({ name: 'currency', example: 'USD' })
  @ApiPaginatedResponse(TransactionLineDto)
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @ApiResponse({ status: 404, description: 'Unknown currency', type: ProblemDetailsDto })
  @Get(':currency/transactions')
  async getTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('currency') currency: string,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<TransactionLineDto>> {
    return this.accountsService.getTransactions(user.id, currency, pagination);
  }
}
