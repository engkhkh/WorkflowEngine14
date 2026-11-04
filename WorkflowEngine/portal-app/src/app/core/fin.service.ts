import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { FinAuditRow, FinControls, FinDefaults, FinKind, FinRec, FinSummary, COMPANY_KINDS } from './fin.models';

/** Finance API. Every call is checked on the server against the user's privileges (finance.*). */
@Injectable({ providedIn: 'root' })
export class FinService {
  private base = environment.apiBaseUrl + '/finance';

  /** reference data cache - fills the drop-downs on every finance page */
  refs = signal<Partial<Record<FinKind, FinRec[]>>>({});

  constructor(private http: HttpClient) {}

  records<D = Record<string, any>>(kind: FinKind, company?: string | null, status?: string): Observable<FinRec<D>[]> {
    let p = new HttpParams();
    if (company) p = p.set('company', company);
    if (status) p = p.set('status', status);
    return this.http.get<FinRec<D>[]>(`${this.base}/records/${kind}`, { params: p });
  }
  create<D = Record<string, any>>(kind: FinKind, r: Partial<FinRec<D>>): Observable<FinRec<D>> {
    return this.http.post<FinRec<D>>(`${this.base}/records/${kind}`, r);
  }
  update<D = Record<string, any>>(kind: FinKind, id: string, r: Partial<FinRec<D>>): Observable<FinRec<D>> {
    return this.http.put<FinRec<D>>(`${this.base}/records/${kind}/${id}`, r);
  }
  remove(kind: FinKind, id: string): Observable<void> { return this.http.delete<void>(`${this.base}/records/${kind}/${id}`); }

  summary(company?: string): Observable<FinSummary> {
    return this.http.get<FinSummary>(`${this.base}/summary`, { params: company ? new HttpParams().set('company', company) : new HttpParams() });
  }
  audit(kind?: string, recordId?: string): Observable<FinAuditRow[]> {
    let p = new HttpParams();
    if (kind) p = p.set('kind', kind);
    if (recordId) p = p.set('recordId', recordId);
    return this.http.get<FinAuditRow[]>(`${this.base}/audit`, { params: p });
  }
  seedAccounts(): Observable<{ created: number }> { return this.http.post<{ created: number }>(`${this.base}/accounts/seed`, {}); }

  /** Loads (and caches) the lists that fill drop-downs. A list the user may not read just stays empty. */
  loadRefs(kinds: FinKind[] = ['account', 'costcenter', 'project', 'currency', 'taxcode', 'vendor', 'customer', 'setting', 'assetclass'], company?: string): Observable<unknown> {
    return forkJoin(kinds.map(k => this.records(k, COMPANY_KINDS.includes(k) ? company : undefined).pipe(
      tap(list => this.refs.update(r => ({ ...r, [k]: list }))),
      map(() => null),
      catchError(() => of(null))
    )));
  }
  ref(kind: FinKind): FinRec[] { return this.refs()[kind] ?? []; }

  controls(): FinControls { return (this.ref('setting').find(s => s.code === 'controls')?.data ?? {}) as FinControls; }
  defaults(): FinDefaults { return (this.ref('setting').find(s => s.code === 'defaults')?.data ?? {}) as FinDefaults; }
}
