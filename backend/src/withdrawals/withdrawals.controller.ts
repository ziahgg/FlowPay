import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ProblemDetailsDto } from '../common/dto/problem-details.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { WithdrawalResponseDto } from './dto/withdrawal-response.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('withdrawals')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @ApiOperation({ summary: 'Request a withdrawal -- holds funds pending admin approval' })
  @ApiResponse({
    status: 201,
    description: 'Withdrawal requested, status pending',
    type: WithdrawalResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or insufficient balance',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @ApiResponse({ status: 404, description: 'Unknown currency', type: ProblemDetailsDto })
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWithdrawalDto,
  ): Promise<WithdrawalResponseDto> {
    return this.withdrawalsService.requestWithdrawal(
      user.id,
      dto.currency,
      dto.amount,
      dto.destination,
    );
  }

  @ApiOperation({
    summary: "Paginated history of the authenticated user's own withdrawal requests",
  })
  @ApiPaginatedResponse(WithdrawalResponseDto)
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<WithdrawalResponseDto>> {
    return this.withdrawalsService.listForUser(user.id, pagination);
  }
}
