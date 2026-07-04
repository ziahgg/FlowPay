import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CreateDepositRequest, DepositResponse } from '../models/deposit.model';

@Injectable({ providedIn: 'root' })
export class DepositsService {
  private readonly http = inject(HttpClient);

  create(request: CreateDepositRequest): Observable<DepositResponse> {
    return this.http.post<DepositResponse>(`${environment.apiUrl}/deposits`, request);
  }
}
