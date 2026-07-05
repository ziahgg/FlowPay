export class RatesResponseDto {
  base!: string;
  asOf!: string;
  source!: string;
  prices!: Record<string, string>;
  matrix!: Record<string, Record<string, string>>;
}
