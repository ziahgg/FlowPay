import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ProblemDetailsDto } from '../common/dto/problem-details.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferHistoryItemDto } from './dto/transfer-history-item.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @ApiOperation({
    summary: 'Send an internal transfer to another user by email',
    description:
      'Idempotent via the required Idempotency-Key header -- generate a fresh UUID per logical ' +
      'attempt and reuse it only when retrying after a network error (see README "Transfers ' +
      'quickstart").',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, example: '5b1b3b0a-...-uuid' })
  @ApiResponse({ status: 201, description: 'Transfer completed', type: TransferResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed, missing Idempotency-Key header, or insufficient balance',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown recipient or currency',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Idempotency key already in progress',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Idempotency key reused with a different request payload',
    type: ProblemDetailsDto,
  })
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateTransferDto,
    @Res() res: Response,
  ): Promise<void> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const result = await this.transfersService.create(user.id, idempotencyKey, dto);
    res.status(result.statusCode).json(result.body);
  }

  @ApiOperation({
    summary: "Paginated history of the authenticated user's sent and received transfers",
  })
  @ApiPaginatedResponse(TransferHistoryItemDto)
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<TransferHistoryItemDto>> {
    return this.transfersService.listHistory(user.id, pagination);
  }
}
