import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ViewChild, inject, signal } from '@angular/core';
import {
  FormGroupDirective,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { AccountBalance } from '../../core/models/account.model';
import { CreateTransferRequest, TransferHistoryItem } from '../../core/models/transfer.model';
import { AccountsService } from '../../core/services/accounts.service';
import { ToastService } from '../../core/services/toast.service';
import { TransfersService } from '../../core/services/transfers.service';
import { CurrencyAmountPipe } from '../../shared/pipes/currency-amount.pipe';

const AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;

@Component({
  selector: 'app-transfer',
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
    MatChipsModule,
    CurrencyAmountPipe,
    DatePipe,
  ],
  templateUrl: './transfer.html',
  styleUrl: './transfer.scss',
})
export class Transfer {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly accountsService = inject(AccountsService);
  private readonly transfersService = inject(TransfersService);
  private readonly toast = inject(ToastService);

  // Needed so a successful submit can reset the *directive's* `submitted` flag along with the
  // form value -- `this.form.reset()` alone leaves `submitted` true, which makes Material show
  // "required" errors on the freshly-cleared fields immediately (no user interaction needed).
  @ViewChild(FormGroupDirective) private formDirective!: FormGroupDirective;

  protected readonly displayedColumns = ['createdAt', 'direction', 'currency', 'amount', 'counterpartyEmail', 'note'];

  protected readonly balances = signal<AccountBalance[]>([]);
  protected readonly submitting = signal(false);
  protected readonly networkError = signal(false);
  protected readonly loadingHistory = signal(true);
  protected readonly history = signal<TransferHistoryItem[]>([]);
  protected readonly total = signal(0);
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(10);

  /**
   * Holds the Idempotency-Key for the *current* attempt sequence. Reused across retries that
   * follow a network error (we don't know whether the server saw the first attempt); cleared on
   * success or on any definitive server response, since a fresh logical operation needs a fresh
   * key.
   */
  private pendingIdempotencyKey: string | null = null;

  protected readonly form = this.fb.group({
    recipientEmail: this.fb.control('', [Validators.required, Validators.email]),
    currency: this.fb.control('', [Validators.required]),
    amount: this.fb.control('', [Validators.required, Validators.pattern(AMOUNT_PATTERN)]),
    note: this.fb.control(''),
  });

  constructor() {
    this.accountsService.getBalances().subscribe((balances) => {
      this.balances.set(balances);
      if (balances[0]) {
        this.form.patchValue({ currency: balances[0].currency });
      }
    });
    this.loadHistory();
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const key = this.pendingIdempotencyKey ?? crypto.randomUUID();
    this.pendingIdempotencyKey = key;

    this.submitting.set(true);
    this.transfersService.create(this.buildPayload(), key).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.networkError.set(false);
        this.pendingIdempotencyKey = null;
        this.toast.success(
          `Sent ${response.amount} ${response.currency}. New balance: ${response.balance}.`,
        );
        this.formDirective.resetForm({
          recipientEmail: '',
          currency: response.currency,
          amount: '',
          note: '',
        });
        this.pageIndex.set(0);
        this.loadHistory();
      },
      error: (error: unknown) => {
        this.submitting.set(false);

        if (error instanceof HttpErrorResponse && error.status === 0) {
          // No response reached us -- the server may or may not have processed the request.
          // Keep the same key so a retry is safe: either it replays the original result, or it
          // performs the operation exactly once.
          this.networkError.set(true);
        } else {
          // The server gave a definitive answer (success would never land here). A fresh attempt
          // is a new logical operation and needs a new key.
          this.networkError.set(false);
          this.pendingIdempotencyKey = null;
        }
      },
    });
  }

  protected onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.loadHistory();
  }

  protected decimalsFor(currency: string): number {
    return this.balances().find((b) => b.currency === currency)?.decimals ?? 2;
  }

  private buildPayload(): CreateTransferRequest {
    const { recipientEmail, currency, amount, note } = this.form.getRawValue();
    return note ? { recipientEmail, currency, amount, note } : { recipientEmail, currency, amount };
  }

  private loadHistory(): void {
    this.loadingHistory.set(true);
    this.transfersService
      .listHistory({ page: this.pageIndex() + 1, limit: this.pageSize() })
      .subscribe({
        next: (response) => {
          this.history.set(response.data);
          this.total.set(response.meta.total);
          this.loadingHistory.set(false);
        },
        error: () => this.loadingHistory.set(false),
      });
  }
}
