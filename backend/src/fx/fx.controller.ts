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
import { ProblemDetailsDto } from '../common/dto/problem-details.dto';
import { ConvertResponseDto } from './dto/convert-response.dto';
import { ConvertDto } from './dto/convert.dto';
import { QuoteQueryDto } from './dto/quote-query.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';
import { RatesResponseDto } from './dto/rates-response.dto';
import { FxService } from './fx.service';

@ApiTags('fx')
@Controller('fx')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @ApiOperation({ summary: 'Full USD-anchored price list and derived pairwise rate matrix' })
  @ApiResponse({ status: 200, description: 'Rates', type: RatesResponseDto })
  @Get('rates')
  async getRates(): Promise<RatesResponseDto> {
    return this.fxService.getRatesMatrix();
  }

  @ApiOperation({ summary: 'Quote a conversion, including spread, without executing it' })
  @ApiResponse({ status: 200, description: 'Quote', type: QuoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'Unknown currency', type: ProblemDetailsDto })
  @Get('quote')
  async getQuote(@Query() query: QuoteQueryDto): Promise<QuoteResponseDto> {
    return this.fxService.getQuote(query);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Execute a currency conversion at the current quote',
    description:
      'Idempotent via the required Idempotency-Key header, same semantics as POST /transfers.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, example: '5b1b3b0a-...-uuid' })
  @ApiResponse({ status: 201, description: 'Converted', type: ConvertResponseDto })
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
  @ApiResponse({ status: 404, description: 'Unknown currency', type: ProblemDetailsDto })
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
  @UseGuards(JwtAuthGuard)
  @Post('convert')
  async convert(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConvertDto,
    @Res() res: Response,
  ): Promise<void> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const result = await this.fxService.convert(user.id, idempotencyKey, dto);
    res.status(result.statusCode).json(result.body);
  }
}
