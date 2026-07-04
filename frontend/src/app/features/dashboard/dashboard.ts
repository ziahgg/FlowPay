import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccountBalance } from '../../core/models/account.model';
import { AccountsService } from '../../core/services/accounts.service';
import { ToastService } from '../../core/services/toast.service';
import { BalanceCard } from '../../shared/components/balance-card/balance-card';
import { DepositDialog } from '../../shared/components/deposit-dialog/deposit-dialog';

@Component({
  selector: 'app-dashboard',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    BalanceCard,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly accountsService = inject(AccountsService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly balances = signal<AccountBalance[]>([]);

  constructor() {
    this.loadBalances();
  }

  protected openDeposit(): void {
    const dialogRef = this.dialog.open(DepositDialog, {
      data: { balances: this.balances() },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.toast.success(`Deposited ${result.amount} ${result.currency}.`);
        this.loadBalances();
      }
    });
  }

  protected goToTransfer(): void {
    void this.router.navigate(['/transfer']);
  }

  protected goToWithdrawals(): void {
    void this.router.navigate(['/withdrawals']);
  }

  private loadBalances(): void {
    this.loading.set(true);
    this.accountsService.getBalances().subscribe({
      next: (balances) => {
        this.balances.set(balances);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
