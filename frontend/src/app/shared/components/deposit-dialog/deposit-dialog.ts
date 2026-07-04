import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { AccountBalance } from '../../../core/models/account.model';
import { DepositResponse } from '../../../core/models/deposit.model';
import { DepositsService } from '../../../core/services/deposits.service';

export interface DepositDialogData {
  balances: AccountBalance[];
}

const AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;

@Component({
  selector: 'app-deposit-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './deposit-dialog.html',
  styleUrl: './deposit-dialog.scss',
})
export class DepositDialog {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly depositsService = inject(DepositsService);
  private readonly dialogRef = inject(MatDialogRef<DepositDialog, DepositResponse>);

  protected readonly data = inject<DepositDialogData>(MAT_DIALOG_DATA);
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.group({
    currency: this.fb.control(this.data.balances[0]?.currency ?? '', [Validators.required]),
    amount: this.fb.control('', [Validators.required, Validators.pattern(AMOUNT_PATTERN)]),
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.depositsService.create(this.form.getRawValue()).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.dialogRef.close(response);
      },
      error: () => this.submitting.set(false),
    });
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}
