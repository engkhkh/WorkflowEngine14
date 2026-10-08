import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, finalize, shareReplay, tap, throwError, of } from 'rxjs';
import { environment } from '../../../environments/environment';

/** A failed API call in one predictable shape. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
  /** the server's response body, under the name HttpErrorResponse uses, so helpers like errMsg() keep working */
  get error() { return this.body; }
  get isForbidden() { return this.status === 403; }
  get isUnauthorized() { return this.status === 401; }
  get isOffline() { return this.status === 0; }
  get isConflict() { return this.status === 409; }
  get isValidation() { return this.status === 400 || this.status === 422; }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const h = e as HttpErrorResponse;
  const b: any = h?.error;
  const msg = typeof b === 'string' && b.length < 300 ? b : typeof b?.message === 'string' ? b.message : typeof b?.title === 'string' ? b.title : h?.message ?? 'Request failed';
  return new ApiError(h?.status ?? 0, msg, b);
}

export interface ApiOptions {
  params?: Record<string, string | number | boolean | null | undefined>;
  /** GET only: keep the answer for this many milliseconds and share it between callers (default: no caching, but identical calls in flight are shared) */
  cacheMs?: number;
}

/**
 * The single door from the screens to the API. Screens call `api.get('erp/crm/records/lead')` instead of building URLs with HttpClient:
 *  - one place for the base URL, query-string building and error shape (ApiError),
 *  - identical GETs in flight are shared and can be cached for a short time,
 *  - any write (POST / PUT / PATCH / DELETE) drops the cached answers under the same top-level path so lists never show stale data.
 * Token, language, correlation id, retry and the 401 / 403 / offline handling live in the interceptor (api.interceptor.ts).
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private http = inject(HttpClient);
  private base = environment.apiBaseUrl;
  private inflight = new Map<string, Observable<unknown>>();
  private cache = new Map<string, { until: number; value: unknown }>();

  private url(path: string) { return /^https?:/.test(path) ? path : `${this.base}/${path.replace(/^\/+/, '')}`; }
  private params(o?: ApiOptions) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(o?.params ?? {})) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return p;
  }
  private fail = <T>() => catchError<T, Observable<never>>(e => throwError(() => toApiError(e)));
  private topPath(path: string) { return path.replace(/^\/+/, '').split('?')[0].split('/').slice(0, 2).join('/'); }
  /** forget cached answers under a path prefix (all of them when no prefix is given) */
  invalidate(prefix?: string) { for (const k of [...this.cache.keys()]) if (!prefix || k.startsWith(this.url(prefix))) this.cache.delete(k); }
  private afterWrite(path: string) { this.invalidate(this.topPath(path)); }

  get<T>(path: string, o?: ApiOptions): Observable<T> {
    const p = this.params(o), key = this.url(path) + '?' + p.toString();
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return of(hit.value as T);
    const running = this.inflight.get(key);
    if (running) return running as Observable<T>;
    const req = this.http.get<T>(this.url(path), { params: p }).pipe(
      tap(v => { if (o?.cacheMs) this.cache.set(key, { until: Date.now() + o.cacheMs, value: v }); }),
      this.fail<T>(), finalize(() => this.inflight.delete(key)), shareReplay({ bufferSize: 1, refCount: true }));
    this.inflight.set(key, req);
    return req;
  }
  post<T>(path: string, body: unknown = {}, o?: ApiOptions): Observable<T> { return this.http.post<T>(this.url(path), body, { params: this.params(o) }).pipe(tap(() => this.afterWrite(path)), this.fail<T>()); }
  put<T>(path: string, body: unknown = {}, o?: ApiOptions): Observable<T> { return this.http.put<T>(this.url(path), body, { params: this.params(o) }).pipe(tap(() => this.afterWrite(path)), this.fail<T>()); }
  patch<T>(path: string, body: unknown = {}, o?: ApiOptions): Observable<T> { return this.http.patch<T>(this.url(path), body, { params: this.params(o) }).pipe(tap(() => this.afterWrite(path)), this.fail<T>()); }
  delete<T = void>(path: string, o?: ApiOptions): Observable<T> { return this.http.delete<T>(this.url(path), { params: this.params(o) }).pipe(tap(() => this.afterWrite(path)), this.fail<T>()); }
  blob(path: string, o?: ApiOptions): Observable<Blob> { return this.http.get(this.url(path), { params: this.params(o), responseType: 'blob' }).pipe(this.fail<Blob>()); }
}
