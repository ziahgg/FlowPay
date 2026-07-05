export class QuoteResponseDto {
  from!: string;
  to!: string;
  amount!: string;
  rate!: string;
  spreadBps!: number;
  netRate!: string;
  toAmount!: string;
  quoteExpiresAt!: string;
  source!: string;
}
