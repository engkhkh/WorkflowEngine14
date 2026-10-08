import { Injectable, computed, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { ErpContextService } from './erp-context.service';
import { PosCheckoutBody, PosKind, PosRec, PosSettings, PosSummary, POS_DEFAULTS } from './pos.models';

export interface PosQuery { company?: string | null; branch?: string | null; status?: string; from?: string; to?: string; take?: number; }
const QUEUE_KEY = 'portal_pos_queue';

/** Point-of-sale API. Every call is checked on the server against the user's privileges (pos.*). */
@Injectable({ providedIn: 'root' })
export class PosService {
  private base = environment.apiBaseUrl + '/pos';

  /** catalogue cache - fills the till and the drop-downs on the other pages */
  products = signal<PosRec[]>([]);
  categories = signal<PosRec[]>([]);
  customers = signal<PosRec[]>([]);
  promotions = signal<PosRec[]>([]);
  registers = signal<PosRec[]>([]);
  settingRec = signal<PosRec | null>(null);
  settings = computed<Required<PosSettings>>(() => ({ ...POS_DEFAULTS, ...((this.settingRec()?.data ?? {}) as PosSettings) }));
  shift = signal<PosRec | null>(null);

  /** sales rung up while the network was down; sent again (once each, the server de-duplicates by localId) when it is back */
  queue = signal<PosCheckoutBody[]>(this.readQueue());

  /** the branch the till / stock pages work in: the one picked in the header, else the first; empty when the company has no branches */
  hasBranches = computed(() => this.ctx.branches().length > 0);
  branch = computed(() => !this.hasBranches() ? '' : (this.ctx.branch() !== 'ALL' ? this.ctx.branch() : this.ctx.branches()[0].code));

  constructor(private http: HttpClient, private ctx: ErpContextService) {
    if (typeof window !== 'undefined') window.addEventListener('online', () => this.flush());
  }

  records<D = Record<string, any>>(kind: PosKind, q: PosQuery = {}): Observable<PosRec<D>[]> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return this.http.get<PosRec<D>[]>(`${this.base}/records/${kind}`, { params: p });
  }
  create(kind: PosKind, r: Partial<PosRec>): Observable<PosRec> { return this.http.post<PosRec>(`${this.base}/records/${kind}`, r); }
  update(kind: PosKind, id: string, r: Partial<PosRec>): Observable<PosRec> { return this.http.put<PosRec>(`${this.base}/records/${kind}/${id}`, r); }
  remove(kind: PosKind, id: string): Observable<void> { return this.http.delete<void>(`${this.base}/records/${kind}/${id}`); }
  bulk(kind: 'product' | 'customer' | 'category', rows: Partial<PosRec>[]): Observable<{ created: number; updated: number; skipped: number }> {
    return this.http.post<{ created: number; updated: number; skipped: number }>(`${this.base}/records/${kind}/bulk`, rows);
  }

  /** loads (and caches) the catalogue; a list the user may not read stays empty */
  loadCatalog(company: string, branch: string): Observable<unknown> {
    const get = (k: PosKind, sig: { set(v: PosRec[]): void }, q: PosQuery) => this.records(k, q).pipe(tap(l => sig.set(l)), catchError(() => of(null)));
    return forkJoin([
      get('product', this.products, { company, take: 5000 }), get('category', this.categories, { company }),
      get('customer', this.customers, { company, take: 5000 }), get('promotion', this.promotions, { company, branch }),
      get('register', this.registers, { company, branch }),
      this.records('setting', { company }).pipe(tap(l => this.settingRec.set(l.find(s => s.code === 'pos') ?? null)), catchError(() => of(null))),
    ]).pipe(map(() => null));
  }

  checkout(b: PosCheckoutBody): Observable<PosRec> { return this.http.post<PosRec>(`${this.base}/sales/checkout`, b); }
  returnSale(id: string, lines: { sku: string; qty: number }[], method: string, reason?: string): Observable<PosRec> {
    return this.http.post<PosRec>(`${this.base}/sales/${id}/return`, { lines, method, reason });
  }
  voidSale(id: string): Observable<PosRec> { return this.http.post<PosRec>(`${this.base}/sales/${id}/void`, {}); }

  currentShift(register?: string): Observable<PosRec | null> {
    return this.http.get<PosRec | null>(`${this.base}/shifts/current`, { params: register ? new HttpParams().set('register', register) : new HttpParams() })
      .pipe(map(s => s ?? null), tap(s => this.shift.set(s)));
  }
  openShift(b: { company?: string; branch?: string; register?: string; openingCash: number }): Observable<PosRec> {
    return this.http.post<PosRec>(`${this.base}/shifts/open`, b).pipe(tap(s => this.shift.set(s)));
  }
  cashMove(id: string, type: 'in' | 'out', amount: number, reason?: string): Observable<PosRec> {
    return this.http.post<PosRec>(`${this.base}/shifts/${id}/cash`, { type, amount, reason }).pipe(tap(s => this.shift.set(s)));
  }
  closeShift(id: string, countedCash: number, note?: string): Observable<PosRec> {
    return this.http.post<PosRec>(`${this.base}/shifts/${id}/close`, { countedCash, note }).pipe(tap(() => this.shift.set(null)));
  }

  adjust(b: { company?: string; branch?: string; sku: string; delta?: number; counted?: number; reason?: string }): Observable<PosRec> { return this.http.post<PosRec>(`${this.base}/stock/adjust`, b); }
  transfer(b: { company?: string; fromBranch: string; toBranch: string; lines: { sku: string; qty: number }[]; note?: string }): Observable<PosRec> { return this.http.post<PosRec>(`${this.base}/transfers`, b); }
  receive(id: string): Observable<PosRec> { return this.http.post<PosRec>(`${this.base}/transfers/${id}/receive`, {}); }

  summary(company?: string, branch?: string, days = 14): Observable<PosSummary> {
    let p = new HttpParams().set('days', days);
    if (company) p = p.set('company', company);
    if (branch && branch !== 'ALL') p = p.set('branch', branch);
    return this.http.get<PosSummary>(`${this.base}/summary`, { params: p });
  }

  // ---- offline queue -------------------------------------------------------------------
  private readQueue(): PosCheckoutBody[] { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); } catch { return []; } }
  private saveQueue(q: PosCheckoutBody[]) { this.queue.set(q); try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* ignore */ } }
  enqueue(b: PosCheckoutBody) { this.saveQueue([...this.queue(), b]); }
  rejected = signal<PosCheckoutBody[]>((() => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY + '_rejected') ?? '[]'); } catch { return []; } })());
  private reject(b: PosCheckoutBody) {
    const r = [...this.rejected(), b]; this.rejected.set(r);
    try { localStorage.setItem(QUEUE_KEY + '_rejected', JSON.stringify(r)); } catch { /* ignore */ }
  }
  clearRejected() { this.rejected.set([]); try { localStorage.removeItem(QUEUE_KEY + '_rejected'); } catch { /* ignore */ } }
  flush() {
    const q = this.queue();
    if (!q.length) return;
    const [first, ...rest] = q;
    this.checkout(first).subscribe({
      next: () => { this.saveQueue(rest); this.flush(); },
      error: e => { if (e?.status && e.status !== 0 && e.status !== 502 && e.status !== 503) { this.reject(first); this.saveQueue(rest); this.flush(); } }   // a sale the server refuses moves to the rejected list for a person to look at; a network error is retried later
    });
  }
}
