export interface CreateDepositRequest {
  currency: string;
  amount: string;
}

export interface DepositResponse {
  currency: string;
  amount: string;
  balance: string;
}
