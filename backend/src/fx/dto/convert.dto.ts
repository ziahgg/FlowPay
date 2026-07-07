import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ConvertDto {
  @ApiProperty({ example: 'USD' })
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  from!: string;

  @ApiProperty({ example: 'BTC' })
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  to!: string;

  @ApiProperty({
    example: '100.00',
    description: 'Positive decimal string, up to 8 decimal places',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: 'amount must be a positive decimal string with up to 8 decimal places',
  })
  amount!: string;
}
