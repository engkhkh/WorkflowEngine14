import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '../../environments/environment';

export type HosKind = 'department' | 'doctor' | 'ward' | 'bed' | 'service' | 'labtest' | 'drug' | 'setting' | 'drugmove' | 'patient' | 'appointment' | 'visit'
  | 'prescription' | 'labrequest' | 'admission' | 'invoice' | 'audit';

export interface HosRec<D = Record<string, any>> {
  id: string; kind: HosKind; code: string; company?: string | null; branch?: string | null; status?: string | null; ref?: string | null; parent?: string | null;
  data: D; createdBy?: string; createdAt: string; updatedAt?: string | null;
}
export interface HosQuery { q?: string; status?: string; parent?: string; ref?: string; branch?: string; from?: string; to?: string; take?: number; }

export interface HosDashboard {
  patients: number; openVisits: number; admitted: number; pendingLabs: number; pendingRx: number;
  appointmentsToday: { total: number; booked: number; checkedIn: number; completed: number; cancelled: number };
  beds: { total: number; occupied: number; available: number; maintenance: number; occupancyPct: number };
  revenueToday: number; revenueWeek: number; outstanding: number;
  lowStock: { code: string; name: string; stock: number; reorder: number }[];
  days: { day: string; visits: number; appointments: number }[];
  topDiagnoses: { name: string; count: number }[];
}

export const HOS_NAV: { path: string; label: string; icon: string; any: string[] }[] = [
  { path: 'overview', label: 'hos.nav.overview', icon: 'bar-chart', any: ['hos.view', 'hos.reports.view'] },
  { path: 'patients', label: 'hos.nav.patients', icon: 'users', any: ['hos.patients.view'] },
  { path: 'appointments', label: 'hos.nav.appointments', icon: 'clock', any: ['hos.appointments.view'] },
  { path: 'visits', label: 'hos.nav.visits', icon: 'heart', any: ['hos.clinical.view'] },
  { path: 'lab', label: 'hos.nav.lab', icon: 'sparkles', any: ['hos.lab.view'] },
  { path: 'pharmacy', label: 'hos.nav.pharmacy', icon: 'box', any: ['hos.pharmacy.view'] },
  { path: 'wards', label: 'hos.nav.wards', icon: 'layers', any: ['hos.wards.view'] },
  { path: 'billing', label: 'hos.nav.billing', icon: 'wallet', any: ['hos.billing.view'] },
  { path: 'setup', label: 'hos.nav.setup', icon: 'settings', any: ['hos.setup'] },
];
export const HOS_ANY: string[] = ['hos.view', 'hos.patients.view', 'hos.appointments.view', 'hos.clinical.view', 'hos.lab.view', 'hos.pharmacy.view', 'hos.wards.view', 'hos.billing.view', 'hos.reports.view', 'hos.setup'];

/** Hospital API. Every call is checked on the server against the user's privileges (hos.*); the rules (conflicts, allergies, stock, beds, billing) live there too. */
@Injectable({ providedIn: 'root' })
export class HospitalService {
  private base = environment.apiBaseUrl + '/hospital';
  constructor(private http: HttpClient) {}

  records<D = Record<string, any>>(kind: HosKind, q: HosQuery = {}): Observable<HosRec<D>[]> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return this.http.get<HosRec<D>[]>(`${this.base}/records/${kind}`, { params: p });
  }
  create(kind: HosKind, r: Partial<HosRec>): Observable<HosRec> { return this.http.post<HosRec>(`${this.base}/records/${kind}`, r); }
  update(kind: HosKind, id: string, r: Partial<HosRec>): Observable<HosRec> { return this.http.put<HosRec>(`${this.base}/records/${kind}/${id}`, r); }
  remove(kind: HosKind, id: string): Observable<void> { return this.http.delete<void>(`${this.base}/records/${kind}/${id}`); }
  post<T = any>(path: string, body: unknown = {}): Observable<T> { return this.http.post<T>(`${this.base}/${path}`, body); }
  put<T = any>(path: string, body: unknown = {}): Observable<T> { return this.http.put<T>(`${this.base}/${path}`, body); }
  get<T = any>(path: string): Observable<T> { return this.http.get<T>(`${this.base}/${path}`); }

  /** hospital settings of the workspace: currency, tax, payment methods, weekend ... (nothing is tied to one country) */
  cfg = signal<Record<string, any>>({});
  loadCfg(): void { this.records('setting').subscribe({ next: l => this.cfg.set(l.find(r => r.code === 'main')?.data ?? {}), error: () => {} }); }
  currency() { return (this.cfg()['currency'] as string) || ''; }
  methods(): string[] { const m = this.cfg()['paymentMethods']; return Array.isArray(m) && m.length ? m : ['cash', 'card', 'transfer', 'other']; }

  dashboard(): Observable<HosDashboard> { return this.get<HosDashboard>(`dashboard?today=${localToday()}&tz=${-new Date().getTimezoneOffset()}`); }
  patientFile(code: string): Observable<any> { return this.get(`patients/${encodeURIComponent(code)}/file`); }
  seedDemo(currency: string): Observable<unknown> { return this.post('seed-demo', { currency, weekend: localWeekend() }); }
}

/** the user's own calendar day (the server does not know the time zone of whoever is looking at the screen) */
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** weekend days (0 = Sunday) of the user's region, from the browser's locale data; Saturday/Sunday when the browser cannot tell */
export const localWeekend = (): number[] => {
  try { const w = (new (Intl as any).Locale(navigator.language) as any).weekInfo?.weekend as number[] | undefined; if (w?.length) return w.map(x => x % 7); } catch { /* older browsers */ }
  return [0, 6];
};

export const age = (dob?: string) => {
  if (!dob) return '';
  const d = new Date(dob); if (isNaN(+d)) return '';
  const now = new Date(); let y = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) y--;
  return y >= 2 ? String(y) : String(Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth())) + 'm';
};
