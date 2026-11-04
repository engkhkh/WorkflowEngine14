import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { I18nService } from '../core/i18n.service';

export type CusType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'email' | 'phone';
export const CUS_TYPES: CusType[] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'email', 'phone'];
export interface CusField { key: string; label: string; labelAr?: string | null; type: CusType; required?: boolean; options?: string[]; }
export interface CusDef { title: string; titleAr?: string | null; icon: string; color: string; fields: CusField[]; }
export interface CusModule { key: string; def: CusDef; createdAt?: string; }
export interface CusRecord { id: string; kind: string; code: string; status?: string; data: Record<string, any>; createdBy?: string; createdAt: string; updatedAt?: string | null; }

export const CUS_ANY = ['cus.view'];
export const CUS_ICONS = ['grid', 'box', 'users', 'cart', 'shield', 'file', 'wallet', 'store', 'heart', 'clock', 'globe', 'layers', 'bar-chart', 'send', 'settings'];

/** Custom modules of the company: their definitions (name, icon, fields) and records. Privileges cus.* and all validation are on the server. */
@Injectable({ providedIn: 'root' })
export class CustomService {
  private http = inject(HttpClient);
  private i18n = inject(I18nService);
  private base = environment.apiBaseUrl + '/custom';
  modules = signal<CusModule[]>([]);
  loaded = signal(false);

  load(): Observable<CusModule[]> { return this.http.get<CusModule[]>(`${this.base}/modules`).pipe(tap(l => { this.modules.set(l); this.loaded.set(true); })); }
  get(key: string) { return this.modules().find(m => m.key === key); }
  create(def: Partial<CusDef>): Observable<CusModule> { return this.http.post<CusModule>(`${this.base}/modules`, def).pipe(tap(m => this.modules.update(l => [...l, m]))); }
  update(key: string, def: Partial<CusDef>): Observable<CusModule> { return this.http.put<CusModule>(`${this.base}/modules/${key}`, def).pipe(tap(m => this.modules.update(l => l.map(x => x.key === key ? m : x)))); }
  remove(key: string): Observable<void> { return this.http.delete<void>(`${this.base}/modules/${key}`).pipe(tap(() => this.modules.update(l => l.filter(x => x.key !== key)))); }
  records(key: string, q = ''): Observable<CusRecord[]> { return this.http.get<CusRecord[]>(`${this.base}/records/${key}?q=${encodeURIComponent(q)}`); }
  addRecord(key: string, data: Record<string, any>): Observable<CusRecord> { return this.http.post<CusRecord>(`${this.base}/records/${key}`, { data }); }
  saveRecord(key: string, id: string, data: Record<string, any>): Observable<CusRecord> { return this.http.put<CusRecord>(`${this.base}/records/${key}/${id}`, { data }); }
  removeRecord(key: string, id: string): Observable<void> { return this.http.delete<void>(`${this.base}/records/${key}/${id}`); }

  title(m: { def: CusDef }): string { return this.i18n.lang() === 'ar' && m.def.titleAr ? m.def.titleAr : m.def.title; }
  label(f: CusField): string { return this.i18n.lang() === 'ar' && f.labelAr ? f.labelAr : f.label; }
}
