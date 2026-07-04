import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AccountBalance, TransactionLine } from '../models/account.model';
import { PaginatedResponse, PaginationQuery } from '../models/pagination.model';

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly http = inject(HttpClient);

  getBalances(): Observable<AccountBalance[]> {
    return this.http.get<AccountBalance[]>(`${environment.apiUrl}/accounts`);
  }

  getTransactions(
    currency: string,
    pagination: PaginationQuery,
  ): Observable<PaginatedResponse<TransactionLine>> {
    const params = new HttpParams()
      .set('page', pagination.page)
      .set('limit', pagination.limit);

    return this.http.get<PaginatedResponse<TransactionLine>>(
      `${environment.apiUrl}/accounts/${currency}/transactions`,
      { params },
    );
  }
}
