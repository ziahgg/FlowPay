import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { WithdrawalRequestStatus } from '../entities/withdrawal-request-status.enum';

export class AdminListWithdrawalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WithdrawalRequestStatus })
  @IsOptional()
  @IsEnum(WithdrawalRequestStatus)
  status?: WithdrawalRequestStatus;
}
