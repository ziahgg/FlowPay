import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
    canActivate: [guestGuard],
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
    canActivate: [guestGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    canActivate: [authGuard],
  },
  {
    path: 'transactions',
    loadComponent: () =>
      import('./features/transactions/transactions').then((m) => m.Transactions),
    canActivate: [authGuard],
  },
  {
    path: 'withdrawals',
    loadComponent: () => import('./features/withdrawals/withdrawals').then((m) => m.Withdrawals),
    canActivate: [authGuard],
  },
  {
    path: 'transfer',
    loadComponent: () => import('./features/transfer/transfer').then((m) => m.Transfer),
    canActivate: [authGuard],
  },
  {
    path: 'admin/withdrawals',
    loadComponent: () =>
      import('./features/admin/admin-withdrawals/admin-withdrawals').then(
        (m) => m.AdminWithdrawals,
      ),
    canActivate: [authGuard, adminGuard],
  },
  { path: '**', redirectTo: 'dashboard' },
];
