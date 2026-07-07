import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ProblemDetailsDto } from '../common/dto/problem-details.dto';
import { DepositsService } from './deposits.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { DepositResponseDto } from './dto/deposit-response.dto';

@ApiTags('deposits')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('deposits')
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @ApiOperation({ summary: 'Simulate a deposit into the wallet of the given currency' })
  @ApiResponse({ status: 201, description: 'Deposited', type: DepositResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or amount exceeds DEPOSIT_MAX_AMOUNT',
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
    @Body() dto: CreateDepositDto,
  ): Promise<DepositResponseDto> {
    return this.depositsService.deposit(user.id, user.email, dto.currency, dto.amount);
  }
}
