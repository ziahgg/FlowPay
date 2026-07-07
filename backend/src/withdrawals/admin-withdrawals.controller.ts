import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { ProblemDetailsDto } from '../common/dto/problem-details.dto';
import { UserRole } from '../users/entities/user-role.enum';
import { AdminListWithdrawalsQueryDto } from './dto/admin-list-withdrawals-query.dto';
import { WithdrawalResponseDto } from './dto/withdrawal-response.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('admin/withdrawals')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @ApiOperation({
    summary: 'List withdrawal requests across all users, optionally filtered by status',
  })
  @ApiPaginatedResponse(WithdrawalResponseDto)
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user is not an admin',
    type: ProblemDetailsDto,
  })
  @Get()
  async list(
    @Query() query: AdminListWithdrawalsQueryDto,
  ): Promise<PaginatedResponseDto<WithdrawalResponseDto>> {
    const { status, ...pagination } = query;
    return this.withdrawalsService.listForAdmin({ status }, pagination);
  }

  @ApiOperation({ summary: 'Approve a pending withdrawal -- settles the held funds' })
  @ApiParam({ name: 'id', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @ApiResponse({ status: 201, description: 'Approved', type: WithdrawalResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user is not an admin',
    type: ProblemDetailsDto,
  })
  @ApiResponse({ status: 404, description: 'Unknown withdrawal request', type: ProblemDetailsDto })
  @ApiResponse({
    status: 409,
    description: 'Request is no longer pending',
    type: ProblemDetailsDto,
  })
  @Post(':id/approve')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<WithdrawalResponseDto> {
    return this.withdrawalsService.approve(id, admin.id);
  }

  @ApiOperation({
    summary: 'Reject a pending withdrawal -- releases the held funds back to the user',
  })
  @ApiParam({ name: 'id', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @ApiResponse({ status: 201, description: 'Rejected', type: WithdrawalResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user is not an admin',
    type: ProblemDetailsDto,
  })
  @ApiResponse({ status: 404, description: 'Unknown withdrawal request', type: ProblemDetailsDto })
  @ApiResponse({
    status: 409,
    description: 'Request is no longer pending',
    type: ProblemDetailsDto,
  })
  @Post(':id/reject')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<WithdrawalResponseDto> {
    return this.withdrawalsService.reject(id, admin.id);
  }
}
