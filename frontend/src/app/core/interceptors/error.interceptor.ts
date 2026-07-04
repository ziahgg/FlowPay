import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ApiErrorResponse } from '../models/api-error.model';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        toast.error(describeError(error));

        if (error.status === 401 && authService.isAuthenticated()) {
          authService.logout();
          void router.navigate(['/login']);
        }
      } else {
        toast.error('An unexpected error occurred.');
      }

      return throwError(() => error);
    }),
  );
};

function describeError(error: HttpErrorResponse): string {
  if (error.status === 0) {
    return 'Network error — check your connection and try again.';
  }

  const body = error.error as Partial<ApiErrorResponse> | null;
  if (body?.message) {
    return Array.isArray(body.message) ? body.message.join(' ') : body.message;
  }

  return error.message || 'Something went wrong.';
}
