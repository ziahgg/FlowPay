import { Injectable } from '@nestjs/common';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { LedgerService } from '../ledger/ledger.service';
import { AccountBalanceDto } from './dto/account-balance.dto';
import { TransactionLineDto } from './dto/transaction-line.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly ledgerService: LedgerService) {}

  async getBalances(userId: string): Promise<AccountBalanceDto[]> {
    const currencies = await this.ledgerService.listCurrencies();

    return Promise.all(
      currencies.map(async (currency) => {
        const wallet = await this.ledgerService.ensureAccount({
          ownerUserId: userId,
          currencyCode: currency.code,
          kind: AccountKind.USER_WALLET,
        });
        const { balance } = await this.ledgerService.getBalance(wallet.id);

        return { currency: currency.code, balance, decimals: currency.decimals };
      }),
    );
  }

  async getTransactions(
    userId: string,
    currencyCode: string,
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResponseDto<TransactionLineDto>> {
    const currency = await this.ledgerService.getCurrency(currencyCode);
    const wallet = await this.ledgerService.ensureAccount({
      ownerUserId: userId,
      currencyCode: currency.code,
      kind: AccountKind.USER_WALLET,
    });

    const { items, total } = await this.ledgerService.listJournalLines(wallet.id, pagination);

    return {
      data: items.map((line) => ({
        type: line.entry.type,
        direction: line.direction,
        amount: line.amount,
        description: line.entry.description,
        createdAt: line.createdAt,
      })),
      meta: { page: pagination.page, limit: pagination.limit, total },
    };
  }
}
