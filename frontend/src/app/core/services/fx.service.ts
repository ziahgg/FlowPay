import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ConvertRequest, ConvertResponse, Quote, RatesResponse } from '../models/fx.model';

@Injectable({ providedIn: 'root' })
export class FxService {
  private readonly http = inject(HttpClient);

  getRates(): Observable<RatesResponse> {
    return this.http.get<RatesResponse>(`${environment.apiUrl}/fx/rates`);
  }

  getQuote(from: string, to: string, amount: string): Observable<Quote> {
    const params = new HttpParams().set('from', from).set('to', to).set('amount', amount);
    return this.http.get<Quote>(`${environment.apiUrl}/fx/quote`, { params });
  }

  convert(request: ConvertRequest, idempotencyKey: string): Observable<ConvertResponse> {
    return this.http.post<ConvertResponse>(`${environment.apiUrl}/fx/convert`, request, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }
}
