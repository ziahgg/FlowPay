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
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ConvertDto } from './dto/convert.dto';
import { QuoteQueryDto } from './dto/quote-query.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';
import { RatesResponseDto } from './dto/rates-response.dto';
import { FxService } from './fx.service';

@Controller('fx')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('rates')
  async getRates(): Promise<RatesResponseDto> {
    return this.fxService.getRatesMatrix();
  }

  @Get('quote')
  async getQuote(@Query() query: QuoteQueryDto): Promise<QuoteResponseDto> {
    return this.fxService.getQuote(query);
  }

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
