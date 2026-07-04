import { AccountKind } from '../entities/account-kind.enum';

export interface EnsureAccountInput {
  ownerUserId: string | null;
  currencyCode: string;
  kind: AccountKind;
}
