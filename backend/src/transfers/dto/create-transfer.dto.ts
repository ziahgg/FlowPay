import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({ example: 'bob@example.com' })
  @IsEmail()
  recipientEmail!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  currency!: string;

  @ApiProperty({ example: '25.00', description: 'Positive decimal string, up to 8 decimal places' })
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: 'amount must be a positive decimal string with up to 8 decimal places',
  })
  amount!: string;

  @ApiPropertyOptional({ example: 'Happy birthday!', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
