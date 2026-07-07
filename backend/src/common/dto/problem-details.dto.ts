import { ApiProperty } from '@nestjs/swagger';

/**
 * RFC 7807 (application/problem+json) shape, returned by AllExceptionsFilter for every error
 * response in this API -- see common/filters/all-exceptions.filter.ts.
 */
export class ProblemDetailsDto {
  @ApiProperty({ example: 'https://flowpay.dev/problems/bad-request' })
  type!: string;

  @ApiProperty({ example: 'Bad Request' })
  title!: string;

  @ApiProperty({ example: 400 })
  status!: number;

  @ApiProperty({ example: 'amount must be a positive decimal string with up to 8 decimal places' })
  detail!: string;

  @ApiProperty({ example: '/api/v1/deposits' })
  instance!: string;

  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Correlates this error to the structured server log line (X-Request-Id)',
  })
  requestId?: string;
}
