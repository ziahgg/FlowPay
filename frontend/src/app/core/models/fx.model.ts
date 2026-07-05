export interface RatesResponse {
  base: string;
  asOf: string;
  source: string;
  prices: Record<string, string>;
  matrix: Record<string, Record<string, string>>;
}

export interface Quote {
  from: string;
  to: string;
  amount: string;
  rate: string;
  spreadBps: number;
  netRate: string;
  toAmount: string;
  quoteExpiresAt: string;
  source: string;
}

export interface ConvertRequest {
  from: string;
  to: string;
  amount: string;
}

export interface ConvertResponse {
  entryId: string;
  from: string;
  to: string;
  amount: string;
  toAmount: string;
  rate: string;
  netRate: string;
  spreadBps: number;
  fromBalance: string;
  toBalance: string;
}
