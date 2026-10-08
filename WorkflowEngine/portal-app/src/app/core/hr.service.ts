import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Employee, HrKind, HrRecord, HrSummary, ImportResult, ImportRow } from './hr.models';

/** Core HR API. Every call is checked on the server against the user's privileges (hr.*). */
@Injectable({ providedIn: 'root' })
export class HrService {
  private base = environment.apiBaseUrl + '/hr';

  /** reference data cache (positions, jobs, grades ... leave types) - used by dropdowns everywhere */
  refs = signal<Partial<Record<HrKind, HrRecord[]>>>({});

  constructor(private http: HttpClient) {}

  // ---- employees
  employees(): Observable<Employee[]> { return this.http.get<Employee[]>(`${this.base}/employees`); }
  me(): Observable<Employee> { return this.http.get<Employee>(`${this.base}/employees/me`); }
  createEmployee(e: Partial<Employee>): Observable<Employee> { return this.http.post<Employee>(`${this.base}/employees`, e); }
  updateEmployee(id: string, e: Partial<Employee>): Observable<Employee> { return this.http.put<Employee>(`${this.base}/employees/${id}`, e); }
  deleteEmployee(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/employees/${id}`); }
  importEmployees(rows: ImportRow[], updateExisting: boolean): Observable<ImportResult> {
    return this.http.post<ImportResult>(`${this.base}/employees/import`, { rows, updateExisting });
  }

  // ---- generic records
  records<D = Record<string, any>>(kind: HrKind, empNo?: string): Observable<HrRecord<D>[]> {
    const q = empNo ? `?empNo=${encodeURIComponent(empNo)}` : '';
    return this.http.get<HrRecord<D>[]>(`${this.base}/records/${kind}${q}`);
  }
  createRecord<D = Record<string, any>>(kind: HrKind, r: Partial<HrRecord<D>>): Observable<HrRecord<D>> {
    return this.http.post<HrRecord<D>>(`${this.base}/records/${kind}`, r);
  }
  updateRecord<D = Record<string, any>>(kind: HrKind, id: string, r: Partial<HrRecord<D>>): Observable<HrRecord<D>> {
    return this.http.put<HrRecord<D>>(`${this.base}/records/${kind}/${id}`, r);
  }
  deleteRecord(kind: HrKind, id: string): Observable<void> { return this.http.delete<void>(`${this.base}/records/${kind}/${id}`); }

  summary(): Observable<HrSummary> { return this.http.get<HrSummary>(`${this.base}/summary`); }

  /** Loads (and caches) the reference lists that fill the dropdowns. A list the user may not read just stays empty. */
  loadRefs(kinds: HrKind[] = ['unit', 'position', 'job', 'grade', 'costcenter', 'location', 'entity', 'bu', 'leavetype']): Observable<unknown> {
    return forkJoin(kinds.map(k => this.records(k).pipe(
      tap(list => this.refs.update(r => ({ ...r, [k]: list }))),
      map(() => null),
      catchOk()
    )));
  }

  ref(kind: HrKind): HrRecord[] { return this.refs()[kind] ?? []; }
}

function catchOk() { return catchError(() => of(null)); }
