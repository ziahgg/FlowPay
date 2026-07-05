import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import {
  FormGroupDirective,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { AccountBalance } from '../../core/models/account.model';
import { Quote } from '../../core/models/fx.model';
import { AccountsService } from '../../core/services/accounts.service';
import { FxService } from '../../core/services/fx.service';
import { ToastService } from '../../core/services/toast.service';
import {
  ConfirmDialog,
  ConfirmDialogData,
} from '../../shared/components/confirm-dialog/confirm-dialog';
import { CurrencyAmountPipe } from '../../shared/pipes/currency-amount.pipe';

const AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;
const QUOTE_DEBOUNCE_MS = 400;
const QUOTE_REFRESH_MS = 20_000;

@Component({
  selector: 'app-convert',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CurrencyAmountPipe,
  ],
  templateUrl: './convert.html',
  styleUrl: './convert.scss',
})
export class Convert implements OnDestroy {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly accountsService = inject(AccountsService);
  private readonly fxService = inject(FxService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);

  // See CLAUDE.md: `this.form.reset(value)` alone leaves the directive's `submitted` flag set,
  // which makes Material show "required" errors on freshly-cleared fields with no interaction.
  @ViewChild(FormGroupDirective) private formDirective!: FormGroupDirective;

  protected readonly balances = signal<AccountBalance[]>([]);
  protected readonly quote = signal<Quote | null>(null);
  protected readonly quoteLoading = signal(false);
  protected readonly submitting = signal(false);
  protected readonly networkError = signal(false);

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private readonly refreshTimer: ReturnType<typeof setInterval>;

  /** Same reuse-on-network-error / clear-on-definitive-response pattern as the Transfer page. */
  private pendingIdempotencyKey: string | null = null;

  protected readonly form = this.fb.group({
    from: this.fb.control('', [Validators.required]),
    to: this.fb.control('', [Validators.required]),
    amount: this.fb.control('', [Validators.required, Validators.pattern(AMOUNT_PATTERN)]),
  });

  constructor() {
    this.accountsService.getBalances().subscribe((balances) => {
      this.balances.set(balances);
      const [first, second] = balances;
      this.form.patchValue({ from: first?.currency ?? '', to: second?.currency ?? '' });
    });

    this.form.valueChanges.subscribe(() => this.scheduleQuoteRefresh());
    // Keeps the displayed quote "live" even if the user leaves the form untouched, matching the
    // rate cache's own refresh cadence rather than only reacting to user input.
    this.refreshTimer = setInterval(() => this.fetchQuote(), QUOTE_REFRESH_MS);
  }

  ngOnDestroy(): void {
    clearTimeout(this.debounceTimer);
    clearInterval(this.refreshTimer);
  }

  protected decimalsFor(currency: string): number {
    return this.balances().find((b) => b.currency === currency)?.decimals ?? 2;
  }

  protected balanceFor(currency: string): string | null {
    return this.balances().find((b) => b.currency === currency)?.balance ?? null;
  }

  protected onSubmitClick(): void {
    if (this.networkError()) {
      // Already confirmed once; a network-error retry should not re-prompt the user.
      this.submit();
      return;
    }

    this.confirmConvert();
  }

  private scheduleQuoteRefresh(): void {
    clearTimeout(this.debounceTimer);
    this.quote.set(null);

    if (!this.canQuote()) {
      return;
    }

    this.debounceTimer = setTimeout(() => this.fetchQuote(), QUOTE_DEBOUNCE_MS);
  }

  private canQuote(): boolean {
    const { from, to, amount } = this.form.getRawValue();
    return !!from && !!to && from !== to && AMOUNT_PATTERN.test(amount);
  }

  private fetchQuote(): void {
    if (!this.canQuote()) {
      return;
    }

    const { from, to, amount } = this.form.getRawValue();
    this.quoteLoading.set(true);
    this.fxService.getQuote(from, to, amount).subscribe({
      next: (quote) => {
        this.quote.set(quote);
        this.quoteLoading.set(false);
      },
      error: () => {
        this.quote.set(null);
        this.quoteLoading.set(false);
      },
    });
  }

  private confirmConvert(): void {
    const quote = this.quote();
    if (this.form.invalid || !quote || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const spreadPercent = (quote.spreadBps / 100).toFixed(2);
    const dialogRef = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Confirm conversion',
        message:
          `Convert ${quote.amount} ${quote.from} to ${quote.toAmount} ${quote.to}? ` +
          `Rate: 1 ${quote.from} = ${quote.netRate} ${quote.to} (includes a ${spreadPercent}% spread).`,
        confirmLabel: 'Convert',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.submit();
      }
    });
  }

  private submit(): void {
    const { from, to, amount } = this.form.getRawValue();
    const key = this.pendingIdempotencyKey ?? crypto.randomUUID();
    this.pendingIdempotencyKey = key;

    this.submitting.set(true);
    this.fxService.convert({ from, to, amount }, key).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.networkError.set(false);
        this.pendingIdempotencyKey = null;
        this.toast.success(
          `Converted ${response.amount} ${response.from} to ${response.toAmount} ${response.to}.`,
        );
        this.formDirective.resetForm({ from: response.from, to: response.to, amount: '' });
        this.quote.set(null);
        this.accountsService.getBalances().subscribe((balances) => this.balances.set(balances));
      },
      error: (error: unknown) => {
        this.submitting.set(false);

        if (error instanceof HttpErrorResponse && error.status === 0) {
          // No response reached us -- keep the same key so a retry either replays the original
          // result or performs the conversion exactly once.
          this.networkError.set(true);
        } else {
          this.networkError.set(false);
          this.pendingIdempotencyKey = null;
        }
      },
    });
  }
}
