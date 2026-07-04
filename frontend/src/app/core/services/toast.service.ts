import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly snackBar = inject(MatSnackBar);

  error(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 6000,
      panelClass: 'flowpay-toast-error',
      horizontalPosition: 'right',
      verticalPosition: 'top',
    });
  }

  success(message: string): void {
    this.snackBar.open(message, undefined, {
      duration: 3500,
      panelClass: 'flowpay-toast-success',
      horizontalPosition: 'right',
      verticalPosition: 'top',
    });
  }
}
