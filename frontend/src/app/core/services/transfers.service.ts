import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PaginatedResponse, PaginationQuery } from '../models/pagination.model';
import { CreateTransferRequest, TransferHistoryItem, TransferResponse } from '../models/transfer.model';

@Injectable({ providedIn: 'root' })
export class TransfersService {
  private readonly http = inject(HttpClient);

  create(request: CreateTransferRequest, idempotencyKey: string): Observable<TransferResponse> {
    return this.http.post<TransferResponse>(`${environment.apiUrl}/transfers`, request, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  listHistory(pagination: PaginationQuery): Observable<PaginatedResponse<TransferHistoryItem>> {
    const params = new HttpParams().set('page', pagination.page).set('limit', pagination.limit);

    return this.http.get<PaginatedResponse<TransferHistoryItem>>(
      `${environment.apiUrl}/transfers`,
      { params },
    );
  }
}
