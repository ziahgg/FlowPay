export class TransferHistoryItemDto {
  entryId!: string;
  direction!: 'sent' | 'received';
  currency!: string;
  amount!: string;
  counterpartyEmail!: string | null;
  note!: string | null;
  createdAt!: Date;
}
