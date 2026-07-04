import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { AccountBalance } from '../../../core/models/account.model';
import { WithdrawalRequestStatus, WithdrawalResponse } from '../../../core/models/withdrawal.model';
import { AccountsService } from '../../../core/services/accounts.service';
import { ToastService } from '../../../core/services/toast.service';
import { WithdrawalsService } from '../../../core/services/withdrawals.service';
import {
  ConfirmDialog,
  ConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog';
import { StatusChip } from '../../../shared/components/status-chip/status-chip';
import { CurrencyAmountPipe } from '../../../shared/pipes/currency-amount.pipe';

type StatusFilter = WithdrawalRequestStatus | 'all';
type Decision = 'approve' | 'reject';

@Component({
  selector: 'app-admin-withdrawals',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    StatusChip,
    CurrencyAmountPipe,
    DatePipe,
  ],
  templateUrl: './admin-withdrawals.html',
  styleUrl: './admin-withdrawals.scss',
})
export class AdminWithdrawals {
  private readonly withdrawalsService = inject(WithdrawalsService);
  private readonly accountsService = inject(AccountsService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);

  protected readonly displayedColumns = [
    'createdAt',
    'currency',
    'amount',
    'destination',
    'status',
    'actions',
  ];

  protected readonly statusFilter = signal<StatusFilter>('pending');
  protected readonly loading = signal(true);
  protected readonly requests = signal<WithdrawalResponse[]>([]);
  protected readonly balances = signal<AccountBalance[]>([]);
  protected readonly total = signal(0);
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(10);
  protected readonly decidingId = signal<string | null>(null);

  constructor() {
    this.accountsService.getBalances().subscribe((balances) => this.balances.set(balances));
    this.loadRequests();
  }

  protected onStatusFilterChange(status: StatusFilter): void {
    this.statusFilter.set(status);
    this.pageIndex.set(0);
    this.loadRequests();
  }

  protected onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.loadRequests();
  }

  protected decimalsFor(currency: string): number {
    return this.balances().find((b) => b.currency === currency)?.decimals ?? 2;
  }

  protected approve(request: WithdrawalResponse): void {
    this.confirmAndDecide(request, 'approve', {
      title: 'Approve withdrawal',
      message: `Approve withdrawal of ${request.amount} ${request.currency} to "${request.destination}"? This settles the hold to treasury.`,
      confirmLabel: 'Approve',
    });
  }

  protected reject(request: WithdrawalResponse): void {
    this.confirmAndDecide(request, 'reject', {
      title: 'Reject withdrawal',
      message: `Reject withdrawal of ${request.amount} ${request.currency}? The held funds are released back to the user's wallet.`,
      confirmLabel: 'Reject',
      destructive: true,
    });
  }

  private confirmAndDecide(
    request: WithdrawalResponse,
    action: Decision,
    data: ConfirmDialogData,
  ): void {
    const dialogRef = this.dialog.open(ConfirmDialog, { data });

    dialogRef.afterClosed().subscribe((confirmed: boolean | undefined) => {
      if (!confirmed) {
        return;
      }

      this.decidingId.set(request.id);
      const call =
        action === 'approve'
          ? this.withdrawalsService.approve(request.id)
          : this.withdrawalsService.reject(request.id);

      call.subscribe({
        next: () => {
          this.decidingId.set(null);
          this.toast.success(
            `Withdrawal ${action === 'approve' ? 'approved' : 'rejected'}.`,
          );
          this.loadRequests();
        },
        error: () => this.decidingId.set(null),
      });
    });
  }

  private loadRequests(): void {
    this.loading.set(true);
    const filter = this.statusFilter();
    const status = filter === 'all' ? undefined : filter;

    this.withdrawalsService
      .listForAdmin({ page: this.pageIndex() + 1, limit: this.pageSize() }, status)
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
