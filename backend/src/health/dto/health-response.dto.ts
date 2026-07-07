import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({
    enum: ['ok', 'error'],
    example: 'ok',
    description: 'Reflects Postgres only -- see the kafka field for a separate, non-fatal signal',
  })
  status!: 'ok' | 'error';

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  db!: 'up' | 'down';

  @ApiProperty({
    enum: ['up', 'down'],
    example: 'up',
    description: 'Never affects status/HTTP code -- a down broker degrades notifications only',
  })
  kafka!: 'up' | 'down';
}
