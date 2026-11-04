import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ZatcaProfile { sellerName: string; sellerNameAr: string; vatNo: string; crNo: string; street: string; building: string; district: string; city: string; postalCode: string; country: string; }
export interface ZatcaInvoice { issued: boolean; uuid?: string; icv?: number; pih?: string; hash?: string; qr?: string; type?: string; issuedAt?: string; issuedBy?: string; signed?: boolean; xml?: string; }
export interface VatBlock { category: string; count: number; net: number; vat: number; }
export interface VatCodeRow { code: string; count: number; net: number; vat: number; }
export interface VatReturn {
  from: string; to: string; sales: VatBlock[]; purchases: VatBlock[]; salesByCode: VatCodeRow[]; purchasesByCode: VatCodeRow[];
  salesNet: number; purchasesNet: number; outputVat: number; inputVat: number; netVatDue: number;
  salesInvoices: number; purchaseInvoices: number; einvoiced: number; notEinvoiced: number; warnings: { missingTaxCode: { code: string; side: string; vat: number }[] };
}

/** Saudi e-invoicing (ZATCA) and the VAT return - see api/finance/zatca. */
@Injectable({ providedIn: 'root' })
export class GovService {
  private base = environment.apiBaseUrl + '/finance/zatca';
  constructor(private http: HttpClient) {}
  profile(): Observable<ZatcaProfile> { return this.http.get<ZatcaProfile>(`${this.base}/profile`); }
  saveProfile(p: ZatcaProfile): Observable<unknown> { return this.http.put(`${this.base}/profile`, p); }
  invoice(id: string): Observable<ZatcaInvoice> { return this.http.get<ZatcaInvoice>(`${this.base}/invoice/${id}`); }
  issue(id: string): Observable<ZatcaInvoice> { return this.http.post<ZatcaInvoice>(`${this.base}/issue/${id}`, {}); }
  vatReturn(from: string, to: string, company?: string | null): Observable<VatReturn> {
    let p = new HttpParams().set('from', from).set('to', to);
    if (company) p = p.set('company', company);
    return this.http.get<VatReturn>(`${this.base}/vat-return`, { params: p });
  }
}
