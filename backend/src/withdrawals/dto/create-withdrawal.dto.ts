import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWithdrawalDto {
  @ApiProperty({ example: 'USD' })
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  currency!: string;

  @ApiProperty({ example: '50.00', description: 'Positive decimal string, up to 8 decimal places' })
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: 'amount must be a positive decimal string with up to 8 decimal places',
  })
  amount!: string;

  @ApiProperty({
    example: 'IBAN GB29 NWBK 6016 1331 9268 19',
    description: 'Free-form destination -- a simulated bank account or wallet address',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  destination!: string;
}
