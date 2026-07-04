import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { AccountBalance, TransactionLine } from '../../core/models/account.model';
import { AccountsService } from '../../core/services/accounts.service';
import { CurrencyAmountPipe } from '../../shared/pipes/currency-amount.pipe';
import { EntryTypeLabelPipe } from '../../shared/pipes/entry-type-label.pipe';

@Component({
  selector: 'app-transactions',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    MatTableModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatChipsModule,
    CurrencyAmountPipe,
    EntryTypeLabelPipe,
    DatePipe,
  ],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions {
  private readonly accountsService = inject(AccountsService);

  protected readonly displayedColumns = ['date', 'type', 'direction', 'amount', 'description'];

  protected readonly loading = signal(true);
  protected readonly balances = signal<AccountBalance[]>([]);
  protected readonly lines = signal<TransactionLine[]>([]);
  protected readonly total = signal(0);
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(10);
  protected readonly selectedCurrency = signal<string | null>(null);

  constructor() {
    this.accountsService.getBalances().subscribe({
      next: (balances) => {
        this.balances.set(balances);
        const firstCurrency = balances[0]?.currency ?? null;
        this.selectedCurrency.set(firstCurrency);
        if (firstCurrency) {
          this.loadTransactions();
        } else {
          this.loading.set(false);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  protected get selectedDecimals(): number {
    return this.balances().find((b) => b.currency === this.selectedCurrency())?.decimals ?? 2;
  }

  protected onCurrencyChange(currency: string): void {
    this.selectedCurrency.set(currency);
    this.pageIndex.set(0);
    this.loadTransactions();
  }

  protected onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.loadTransactions();
  }

  private loadTransactions(): void {
    const currency = this.selectedCurrency();
    if (!currency) {
      return;
    }

    this.loading.set(true);
    this.accountsService
      .getTransactions(currency, { page: this.pageIndex() + 1, limit: this.pageSize() })
      .subscribe({
        next: (response) => {
          this.lines.set(response.data);
          this.total.set(response.meta.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
