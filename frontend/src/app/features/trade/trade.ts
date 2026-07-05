import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import {
  FormGroupDirective,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import Decimal from 'decimal.js';
import {
  CreateOrderRequest,
  OrderResponse,
  OrderSide,
  OrderStatus,
  OrderType,
} from '../../core/models/order.model';
import { FxService } from '../../core/services/fx.service';
import { OrdersService } from '../../core/services/orders.service';
import { ToastService } from '../../core/services/toast.service';
import {
  ConfirmDialog,
  ConfirmDialogData,
} from '../../shared/components/confirm-dialog/confirm-dialog';
import { StatusChip } from '../../shared/components/status-chip/status-chip';
import { CurrencyAmountPipe } from '../../shared/pipes/currency-amount.pipe';

const AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;
const PRICE_REFRESH_MS = 15_000;

// Frontend-only curated pair list (crypto base / fiat quote) -- the backend itself accepts any two
// distinct existing currencies as a pair (see README "Trading quickstart"); this is just a sensible
// default set to present as a dropdown rather than every combinatorial pair.
const PAIRS = ['BTC/USD', 'BTC/EUR', 'BTC/IDR', 'ETH/USD', 'ETH/EUR', 'ETH/IDR'];

const DECIMALS_BY_CURRENCY: Record<string, number> = {
  BTC: 8,
  ETH: 8,
  USD: 2,
  EUR: 2,
  IDR: 2,
};

type HistoryFilter = OrderStatus | 'all';

@Component({
  selector: 'app-trade',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatPaginatorModule,
    StatusChip,
    CurrencyAmountPipe,
    DatePipe,
    TitleCasePipe,
  ],
  templateUrl: './trade.html',
  styleUrl: './trade.scss',
})
export class Trade implements OnDestroy {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly fxService = inject(FxService);
  private readonly ordersService = inject(OrdersService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);

  // `this.form.reset()`/`patchValue()` alone leaves the directive's `submitted` flag set, which
  // makes Material show "required" errors on freshly-cleared fields with no user interaction.
  @ViewChild(FormGroupDirective) private formDirective!: FormGroupDirective;

  protected readonly pairs = PAIRS;
  protected readonly livePrice = signal<string | null>(null);
  protected readonly priceLoading = signal(false);
  protected readonly submitting = signal(false);

  protected readonly openOrders = signal<OrderResponse[]>([]);
  protected readonly openTotal = signal(0);
  protected readonly openPageIndex = signal(0);
  protected readonly openPageSize = signal(10);
  protected readonly loadingOpen = signal(true);

  protected readonly historyFilter = signal<HistoryFilter>('all');
  protected readonly history = signal<OrderResponse[]>([]);
  protected readonly historyTotal = signal(0);
  protected readonly historyPageIndex = signal(0);
  protected readonly historyPageSize = signal(10);
  protected readonly loadingHistory = signal(true);

  protected readonly openColumns = [
    'createdAt',
    'pair',
    'side',
    'quantity',
    'limitPrice',
    'actions',
  ];
  protected readonly historyColumns = [
    'createdAt',
    'pair',
    'side',
    'type',
    'quantity',
    'filledPrice',
    'status',
  ];

  private priceTimer?: ReturnType<typeof setInterval>;

  protected readonly form = this.fb.group({
    pair: this.fb.control(PAIRS[0], [Validators.required]),
    side: this.fb.control<OrderSide>('buy', [Validators.required]),
    type: this.fb.control<OrderType>('market', [Validators.required]),
    quantity: this.fb.control('', [Validators.required, Validators.pattern(AMOUNT_PATTERN)]),
    limitPrice: this.fb.control(''),
  });

  constructor() {
    this.form.controls.pair.valueChanges.subscribe(() => this.refreshPrice());
    this.form.controls.type.valueChanges.subscribe((type) => this.onTypeChange(type));
    this.refreshPrice();
    this.priceTimer = setInterval(() => this.refreshPrice(), PRICE_REFRESH_MS);

    this.loadOpenOrders();
    this.loadHistory();
  }

  ngOnDestroy(): void {
    clearInterval(this.priceTimer);
  }

  protected get isLimit(): boolean {
    return this.form.controls.type.value === 'limit';
  }

  protected baseOf(pair: string): string {
    return pair.split('/')[0];
  }

  protected quoteOf(pair: string): string {
    return pair.split('/')[1];
  }

  protected decimalsFor(code: string): number {
    return DECIMALS_BY_CURRENCY[code] ?? 2;
  }

  protected estimatedTotal(): string | null {
    const price = this.livePrice();
    const quantity = this.form.controls.quantity.value;
    if (!price || !quantity || !AMOUNT_PATTERN.test(quantity)) {
      return null;
    }
    return new Decimal(quantity).times(price).toFixed(this.decimalsFor(this.quoteOf(this.form.controls.pair.value)));
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { pair, side, type, quantity, limitPrice } = this.form.getRawValue();
    const payload: CreateOrderRequest =
      type === 'limit' ? { pair, side, type, quantity, limitPrice } : { pair, side, type, quantity };

    this.submitting.set(true);
    this.ordersService.create(payload).subscribe({
      next: (order) => {
        this.submitting.set(false);

        if (order.status === 'filled') {
          this.toast.success(
            `${order.side === 'buy' ? 'Bought' : 'Sold'} ${order.quantity} ${this.baseOf(order.pair)} at ${order.filledPrice} ${this.quoteOf(order.pair)}.`,
          );
        } else {
          this.toast.success(
            `Limit order placed for ${order.quantity} ${this.baseOf(order.pair)} at ${order.limitPrice} ${this.quoteOf(order.pair)}.`,
          );
        }

        this.formDirective.resetForm({ pair, side, type, quantity: '', limitPrice: '' });
        this.openPageIndex.set(0);
        this.loadOpenOrders();
        this.historyPageIndex.set(0);
        this.loadHistory();
      },
      error: () => this.submitting.set(false),
    });
  }

  protected cancelOrder(order: OrderResponse): void {
    const dialogRef = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Cancel order',
        message: `Cancel this ${order.side} ${order.type} order for ${order.quantity} ${this.baseOf(order.pair)}? Any held funds are released back to your wallet.`,
        confirmLabel: 'Cancel order',
        destructive: true,
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.ordersService.cancel(order.id).subscribe({
        next: () => {
          this.toast.success('Order cancelled; held funds released.');
          this.loadOpenOrders();
          this.loadHistory();
        },
      });
    });
  }

  protected onOpenPageChange(event: PageEvent): void {
    this.openPageIndex.set(event.pageIndex);
    this.openPageSize.set(event.pageSize);
    this.loadOpenOrders();
  }

  protected onHistoryPageChange(event: PageEvent): void {
    this.historyPageIndex.set(event.pageIndex);
    this.historyPageSize.set(event.pageSize);
    this.loadHistory();
  }

  protected onHistoryFilterChange(filter: HistoryFilter): void {
    this.historyFilter.set(filter);
    this.historyPageIndex.set(0);
    this.loadHistory();
  }

  private onTypeChange(type: OrderType): void {
    const limitPriceControl = this.form.controls.limitPrice;
    if (type === 'limit') {
      limitPriceControl.setValidators([Validators.required, Validators.pattern(AMOUNT_PATTERN)]);
    } else {
      limitPriceControl.clearValidators();
      limitPriceControl.setValue('');
    }
    limitPriceControl.updateValueAndValidity();
  }

  private refreshPrice(): void {
    this.priceLoading.set(true);
    this.fxService.getRates().subscribe({
      next: (rates) => {
        const base = this.baseOf(this.form.controls.pair.value);
        const quote = this.quoteOf(this.form.controls.pair.value);
        this.livePrice.set(rates.matrix[base]?.[quote] ?? null);
        this.priceLoading.set(false);
      },
      error: () => this.priceLoading.set(false),
    });
  }

  private loadOpenOrders(): void {
    this.loadingOpen.set(true);
    this.ordersService
      .list({ page: this.openPageIndex() + 1, limit: this.openPageSize() }, 'open')
      .subscribe({
        next: (res) => {
          this.openOrders.set(res.data);
          this.openTotal.set(res.meta.total);
          this.loadingOpen.set(false);
        },
        error: () => this.loadingOpen.set(false),
      });
  }

  private loadHistory(): void {
    this.loadingHistory.set(true);
    const filter = this.historyFilter();
    const status = filter === 'all' ? undefined : filter;

    this.ordersService
      .list({ page: this.historyPageIndex() + 1, limit: this.historyPageSize() }, status)
      .subscribe({
        next: (res) => {
          this.history.set(res.data);
          this.historyTotal.set(res.meta.total);
          this.loadingHistory.set(false);
        },
        error: () => this.loadingHistory.set(false),
      });
  }
}
