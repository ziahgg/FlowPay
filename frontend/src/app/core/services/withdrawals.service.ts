import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PaginatedResponse, PaginationQuery } from '../models/pagination.model';
import {
  CreateWithdrawalRequest,
  WithdrawalRequestStatus,
  WithdrawalResponse,
} from '../models/withdrawal.model';

@Injectable({ providedIn: 'root' })
export class WithdrawalsService {
  private readonly http = inject(HttpClient);

  create(request: CreateWithdrawalRequest): Observable<WithdrawalResponse> {
    return this.http.post<WithdrawalResponse>(`${environment.apiUrl}/withdrawals`, request);
  }

  listOwn(pagination: PaginationQuery): Observable<PaginatedResponse<WithdrawalResponse>> {
    const params = new HttpParams().set('page', pagination.page).set('limit', pagination.limit);

    return this.http.get<PaginatedResponse<WithdrawalResponse>>(
      `${environment.apiUrl}/withdrawals`,
      { params },
    );
  }

  listForAdmin(
    pagination: PaginationQuery,
    status?: WithdrawalRequestStatus,
  ): Observable<PaginatedResponse<WithdrawalResponse>> {
    let params = new HttpParams().set('page', pagination.page).set('limit', pagination.limit);
    if (status) {
      params = params.set('status', status);
    }

    return this.http.get<PaginatedResponse<WithdrawalResponse>>(
      `${environment.apiUrl}/admin/withdrawals`,
      { params },
    );
  }

  approve(id: string): Observable<WithdrawalResponse> {
    return this.http.post<WithdrawalResponse>(
      `${environment.apiUrl}/admin/withdrawals/${id}/approve`,
      {},
    );
  }

  reject(id: string): Observable<WithdrawalResponse> {
    return this.http.post<WithdrawalResponse>(
      `${environment.apiUrl}/admin/withdrawals/${id}/reject`,
      {},
    );
  }
}
