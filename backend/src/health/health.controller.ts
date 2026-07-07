import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @ApiOperation({ summary: 'Liveness/readiness probe -- reports Postgres connectivity' })
  @ApiResponse({ status: 200, description: 'All dependencies are up', type: HealthResponseDto })
  @ApiResponse({ status: 503, description: 'A dependency is down', type: HealthResponseDto })
  @Get()
  async check(@Res() res: Response): Promise<void> {
    const result = await this.healthService.check();
    const httpStatus = result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    res.status(httpStatus).json(result);
  }
}
