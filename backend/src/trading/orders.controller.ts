import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { ProblemDetailsDto } from '../common/dto/problem-details.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiOperation({
    summary: 'Place a market or limit order',
    description:
      'A market order fills immediately at the current rate. A limit order holds funds ' +
      'immediately and fills later if the price crosses (checked by a background worker every ' +
      '~10s) -- see README "Trading quickstart".',
  })
  @ApiResponse({
    status: 201,
    description: 'Order created (filled immediately if market)',
    type: OrderResponseDto,
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
  @ApiResponse({
    status: 404,
    description: 'Unknown currency in the pair',
    type: ProblemDetailsDto,
  })
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.createOrder(user.id, dto);
  }

  @ApiOperation({ summary: 'Cancel an open limit order, releasing its held funds' })
  @ApiParam({ name: 'id', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @ApiResponse({ status: 200, description: 'Cancelled', type: OrderResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: "Unknown order or not this user's",
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Order is no longer open (already filled or cancelled)',
    type: ProblemDetailsDto,
  })
  @Delete(':id')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.cancelOrder(user.id, id);
  }

  @ApiOperation({ summary: "Paginated history of the authenticated user's own orders" })
  @ApiPaginatedResponse(OrderResponseDto)
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    type: ProblemDetailsDto,
  })
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedResponseDto<OrderResponseDto>> {
    const { status, ...pagination } = query;
    return this.ordersService.listForUser(user.id, { status }, pagination);
  }
}
