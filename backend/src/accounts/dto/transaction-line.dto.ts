export class TransactionLineDto {
  type!: string;
  direction!: string;
  amount!: string;
  description!: string | null;
  createdAt!: Date;
}
