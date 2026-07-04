import { DatePipe } from '@angular/common';
import { Component, ViewChild, inject, signal } from '@angular/core';
import {
  FormGroupDirective,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { AccountBalance } from '../../core/models/account.model';
import { WithdrawalResponse } from '../../core/models/withdrawal.model';
import { AccountsService } from '../../core/services/accounts.service';
import { ToastService } from '../../core/services/toast.service';
import { WithdrawalsService } from '../../core/services/withdrawals.service';
import { CurrencyAmountPipe } from '../../shared/pipes/currency-amount.pipe';
import { StatusChip } from '../../shared/components/status-chip/status-chip';

const AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;

@Component({
  selector: 'app-withdrawals',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatPaginatorModule,
    CurrencyAmountPipe,
    StatusChip,
    DatePipe,
  ],
  templateUrl: './withdrawals.html',
  styleUrl: './withdrawals.scss',
})
export class Withdrawals {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly accountsService = inject(AccountsService);
  private readonly withdrawalsService = inject(WithdrawalsService);
  private readonly toast = inject(ToastService);

  // `this.form.reset()`/`patchValue()` alone leaves the directive's `submitted` flag set, which
  // makes Material show "required" errors on freshly-cleared fields with no user interaction.
  @ViewChild(FormGroupDirective) private formDirective!: FormGroupDirective;

  protected readonly displayedColumns = ['createdAt', 'currency', 'amount', 'destination', 'status'];

  protected readonly balances = signal<AccountBalance[]>([]);
  protected readonly submitting = signal(false);
  protected readonly loading = signal(true);
  protected readonly requests = signal<WithdrawalResponse[]>([]);
  protected readonly total = signal(0);
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(10);

  protected readonly form = this.fb.group({
    currency: this.fb.control('', [Validators.required]),
    amount: this.fb.control('', [Validators.required, Validators.pattern(AMOUNT_PATTERN)]),
    destination: this.fb.control('', [Validators.required, Validators.maxLength(255)]),
  });

  constructor() {
    this.accountsService.getBalances().subscribe((balances) => {
      this.balances.set(balances);
      if (balances[0]) {
        this.form.patchValue({ currency: balances[0].currency });
      }
    });
    this.loadRequests();
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.withdrawalsService.create(this.form.getRawValue()).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.toast.success(`Withdrawal of ${response.amount} ${response.currency} requested.`);
        this.formDirective.resetForm({ currency: response.currency, amount: '', destination: '' });
        this.pageIndex.set(0);
        this.loadRequests();
      },
      error: () => this.submitting.set(false),
    });
  }

  protected onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.loadRequests();
  }

  protected decimalsFor(currency: string): number {
    return this.balances().find((b) => b.currency === currency)?.decimals ?? 2;
  }

  private loadRequests(): void {
    this.loading.set(true);
    this.withdrawalsService
      .listOwn({ page: this.pageIndex() + 1, limit: this.pageSize() })
      .subscribe({
        next: (response) => {
          this.requests.set(response.data);
          this.total.set(response.meta.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
