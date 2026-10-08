import { Injectable, computed, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { ErpInsight, ErpItem, ErpKind, ErpLookup, ErpModule, ErpQuery, ErpRec, ErpSummary, WhStockRow } from './erp.models';

/** Manufacturing / Projects / CRM API. Every call is checked on the server against the user's privileges (mfg.* / prj.* / crm.*). */
@Injectable({ providedIn: 'root' })
export class ErpService {
  private base = environment.apiBaseUrl + '/erp';

  /** items = the Point-of-sale products (shared item master) */
  items = signal<ErpItem[]>([]);
  itemMap = computed(() => new Map(this.items().map(i => [i.sku, i])));
  /** small reference lists (projects, accounts, BOMs ...) cached for the drop-downs */
  private refs = new Map<string, ReturnType<typeof signal<ErpRec[]>>>();

  constructor(private http: HttpClient) {}

  records<D = Record<string, any>>(module: ErpModule, kind: ErpKind, q: ErpQuery = {}): Observable<ErpRec<D>[]> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k === 'ref' ? 'ref' : k, String(v));
    return this.http.get<ErpRec<D>[]>(`${this.base}/${module}/records/${kind}`, { params: p });
  }
  create(module: ErpModule, kind: ErpKind, r: Partial<ErpRec>): Observable<ErpRec> { return this.http.post<ErpRec>(`${this.base}/${module}/records/${kind}`, r); }
  update(module: ErpModule, kind: ErpKind, id: string, r: Partial<ErpRec>): Observable<ErpRec> { return this.http.put<ErpRec>(`${this.base}/${module}/records/${kind}/${id}`, r); }
  remove(module: ErpModule, kind: ErpKind, id: string): Observable<void> { return this.http.delete<void>(`${this.base}/${module}/records/${kind}/${id}`); }

  /** reference list as a signal, loaded on first use and refreshed with {@link refresh} */
  ref(module: ErpModule, kind: ErpKind, company?: string | null): ErpRec[] {
    const key = module + ':' + kind;
    let s = this.refs.get(key);
    if (!s) { s = signal<ErpRec[]>([]); this.refs.set(key, s); this.refresh(module, kind, company).subscribe(); }
    return s();
  }
  refresh(module: ErpModule, kind: ErpKind, company?: string | null): Observable<ErpRec[]> {
    const key = module + ':' + kind;
    let s = this.refs.get(key);
    if (!s) { s = signal<ErpRec[]>([]); this.refs.set(key, s); }
    const sig = s;
    return this.records(module, kind, { company, take: 5000 }).pipe(tap(l => sig.set(l)), catchError(() => of([] as ErpRec[])));
  }

  /** workspace user directory (assignee / employee pickers) */
  users(): Observable<{ username: string; displayName: string; role: string }[]> {
    return this.http.get<ErpLookup[]>(`${this.base}/mfg/lookups/users`).pipe(
      map(l => (Array.isArray(l) ? l : []).map(u => ({ username: u.code, displayName: u.name, role: u.extra ?? '' }))), catchError(() => of([])));
  }

  loadItems(module: ErpModule, company?: string | null): Observable<ErpItem[]> {
    let p = new HttpParams(); if (company) p = p.set('company', company);
    return this.http.get<ErpItem[]>(`${this.base}/${module}/items`, { params: p }).pipe(tap(l => this.items.set(l)), catchError(() => of([] as ErpItem[])));
  }
  stock(company?: string | null, branch?: string | null): Observable<{ sku: string; qty: number }[]> {
    let p = new HttpParams(); if (company) p = p.set('company', company); if (branch && branch !== 'ALL') p = p.set('branch', branch);
    return this.http.get<{ sku: string; qty: number }[]>(`${this.base}/mfg/stock`, { params: p });
  }

  /** generic POST action on a module (e.g. 'pos/ID/approve', 'runs/ID/calculate') */
  action<T = ErpRec>(module: ErpModule, path: string, body: any = {}): Observable<T> { return this.http.post<T>(`${this.base}/${module}/${path}`, body); }
  lookup(module: ErpModule, what: 'vendors' | 'customers' | 'employees' | 'costcenters' | 'accounts' | 'taxcodes', company?: string | null): Observable<ErpLookup[]> {
    let p = new HttpParams(); if (company) p = p.set('company', company);
    return this.http.get<ErpLookup[]>(`${this.base}/${module}/lookups/${what}`, { params: p }).pipe(catchError(() => of([] as ErpLookup[])));
  }
  whStock(company?: string | null, branch?: string | null): Observable<WhStockRow[]> {
    let p = new HttpParams(); if (company) p = p.set('company', company); if (branch && branch !== 'ALL') p = p.set('branch', branch);
    return this.http.get<WhStockRow[]>(`${this.base}/wh/wh-stock`, { params: p });
  }
  createKey(name: string, scopes: string[]): Observable<{ id: string; key: string; prefix: string }> { return this.http.post<{ id: string; key: string; prefix: string }>(`${this.base}/int/apikeys`, { name, scopes }); }
  biOverview(company?: string | null): Observable<ErpSummary[]> {
    let p = new HttpParams(); if (company) p = p.set('company', company);
    return this.http.get<ErpSummary[]>(`${this.base}/bi/overview`, { params: p });
  }
  insights(company?: string | null): Observable<ErpInsight[]> {
    let p = new HttpParams(); if (company) p = p.set('company', company);
    return this.http.get<ErpInsight[]>(`${this.base}/bi/insights`, { params: p });
  }

  // manufacturing
  workOrder(id: string, action: 'release' | 'start' | 'complete' | 'cancel', body: { qty?: number; scrap?: number; hours?: number; note?: string } = {}): Observable<ErpRec> {
    return this.http.post<ErpRec>(`${this.base}/mfg/workorders/${id}/${action}`, body);
  }
  // projects
  bill(id: string, body: { taxPct: number; date?: string; termsDays?: number }): Observable<{ invoice: string; net: number; tax: number; total: number; lines: number }> {
    return this.http.post<{ invoice: string; net: number; tax: number; total: number; lines: number }>(`${this.base}/prj/projects/${id}/bill`, body);
  }
  // crm
  convertLead(id: string, body: { createOpportunity: boolean; amount: number }): Observable<{ account: string; contact: string; opportunity: string | null }> {
    return this.http.post<{ account: string; contact: string; opportunity: string | null }>(`${this.base}/crm/leads/${id}/convert`, body);
  }
  closeOpportunity(id: string, result: 'won' | 'lost' | 'reopen', reason?: string): Observable<ErpRec> {
    return this.http.post<ErpRec>(`${this.base}/crm/opportunities/${id}/${result}`, { reason: reason ?? '' });
  }

  summary(module: ErpModule, company?: string | null): Observable<ErpSummary> {
    let p = new HttpParams(); if (company) p = p.set('company', company);
    return this.http.get<ErpSummary>(`${this.base}/${module}/summary`, { params: p });
  }
}
