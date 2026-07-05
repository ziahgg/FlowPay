import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CreateOrderRequest, OrderResponse, OrderStatus } from '../models/order.model';
import { PaginatedResponse, PaginationQuery } from '../models/pagination.model';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly http = inject(HttpClient);

  create(request: CreateOrderRequest): Observable<OrderResponse> {
    return this.http.post<OrderResponse>(`${environment.apiUrl}/orders`, request);
  }

  cancel(id: string): Observable<OrderResponse> {
    return this.http.delete<OrderResponse>(`${environment.apiUrl}/orders/${id}`);
  }

  list(
    pagination: PaginationQuery,
    status?: OrderStatus,
  ): Observable<PaginatedResponse<OrderResponse>> {
    let params = new HttpParams().set('page', pagination.page).set('limit', pagination.limit);
    if (status) {
      params = params.set('status', status);
    }

    return this.http.get<PaginatedResponse<OrderResponse>>(`${environment.apiUrl}/orders`, {
      params,
    });
  }
}
