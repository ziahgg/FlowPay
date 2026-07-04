export type WithdrawalRequestStatus = 'pending' | 'approved' | 'rejected';

export interface CreateWithdrawalRequest {
  currency: string;
  amount: string;
  destination: string;
}

export interface WithdrawalResponse {
  id: string;
  currency: string;
  amount: string;
  destination: string;
  status: WithdrawalRequestStatus;
  holdEntryId: string;
  settleEntryId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}
