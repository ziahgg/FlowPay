export interface CreateTransferRequest {
  recipientEmail: string;
  currency: string;
  amount: string;
  note?: string;
}

export interface TransferResponse {
  entryId: string;
  currency: string;
  amount: string;
  balance: string;
}

export type TransferDirection = 'sent' | 'received';

export interface TransferHistoryItem {
  entryId: string;
  direction: TransferDirection;
  currency: string;
  amount: string;
  counterpartyEmail: string | null;
  note: string | null;
  createdAt: string;
}
