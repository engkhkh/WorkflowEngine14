import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, retry, throwError, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth.service';
import { I18nService } from '../i18n.service';
import { ApiGateway } from './api-gateway.service';

const newId = () => (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * The HTTP layer between the app and the API (only calls to our own API are touched):
 *  - adds the bearer token, the UI language (Accept-Language) and a correlation id (X-Correlation-Id, also useful in server logs),
 *  - counts calls in flight for the progress bar,
 *  - retries idempotent GETs a couple of times on network errors / 502 / 503 / 504 (never writes),
 *  - 401: ends the session once and sends the user to the login page; 403 / offline / 5xx on a user action: raises a notice.
 * Errors are passed on unchanged, so every screen keeps showing its own message.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) return next(req);
  const auth = inject(AuthService), router = inject(Router), gw = inject(ApiGateway), i18n = inject(I18nService);
  const token = auth.getToken();
  const headers: Record<string, string> = { 'X-Correlation-Id': newId(), 'Accept-Language': i18n.lang() };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const authed = req.clone({ setHeaders: headers });
  const isGet = req.method === 'GET', isLogin = /\/auth\/login$|\/tenants\/signup$/.test(req.url);

  gw.begin();
  let stream = next(authed);
  if (isGet) stream = stream.pipe(retry({
    count: 2,
    delay: (err: HttpErrorResponse, n) => [0, 502, 503, 504].includes(err.status) ? timer(400 * 2 ** (n - 1)) : throwError(() => err)
  }));
  return stream.pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !isLogin) {
        if (auth.getToken()) { gw.raise('session'); auth.logout(); router.navigate(['/login']); }
      } else if (err.status === 0) { if (!isGet) gw.raise('offline'); }
      else if (err.status === 403) { if (!isGet) gw.raise('forbidden'); }
      else if (err.status >= 500) { if (!isGet) gw.raise('server'); }
      return throwError(() => err);
    }),
    finalize(() => gw.end())
  );
};
