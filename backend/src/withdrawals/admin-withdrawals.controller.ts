import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { UserRole } from '../users/entities/user-role.enum';
import { AdminListWithdrawalsQueryDto } from './dto/admin-list-withdrawals-query.dto';
import { WithdrawalResponseDto } from './dto/withdrawal-response.dto';
import { WithdrawalsService } from './withdrawals.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get()
  async list(
    @Query() query: AdminListWithdrawalsQueryDto,
  ): Promise<PaginatedResponseDto<WithdrawalResponseDto>> {
    const { status, ...pagination } = query;
    return this.withdrawalsService.listForAdmin({ status }, pagination);
  }

  @Post(':id/approve')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<WithdrawalResponseDto> {
    return this.withdrawalsService.approve(id, admin.id);
  }

  @Post(':id/reject')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<WithdrawalResponseDto> {
    return this.withdrawalsService.reject(id, admin.id);
  }
}
