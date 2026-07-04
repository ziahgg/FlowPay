import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTransferDto {
  @IsEmail()
  recipientEmail!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(10)
  currency!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: 'amount must be a positive decimal string with up to 8 decimal places',
  })
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
