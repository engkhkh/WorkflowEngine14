import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminUser, SignupPayload, User } from './models';

interface LoginResponse {
  token: string;
  id: string;
  username: string;
  displayName: string;
  role: string;
  permissions?: string[];
  tenantId?: string;
  tenantName?: string;
}

const TOKEN_KEY = 'portal_token';
const USER_KEY = 'portal_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private base = environment.apiBaseUrl;
  currentUser = signal<User | null>(this.loadUser());

  constructor(private http: HttpClient) {}

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.base}/auth/login`, { username, password }).pipe(tap(res => this.store(res)));
  }

  /** SaaS self-service: creates a private workspace (+ first company/branch) and signs the new admin in. */
  signup(payload: SignupPayload): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.base}/tenants/signup`, payload).pipe(tap(res => this.store(res)));
  }

  /** Re-reads the signed-in user's current privileges (an admin may have changed them). */
  refreshMe(): Observable<AdminUser | null> {
    return this.http.get<AdminUser>(`${this.base}/users/me`).pipe(
      tap(me => {
        const u = this.currentUser();
        if (!u) return;
        this.setUser({ ...u, role: me.role, displayName: me.displayName, permissions: me.effectivePermissions });
      }),
      catchError(() => of(null))
    );
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.currentUser.set(null);
  }

  /**
   * Does the signed-in user hold this privilege? (The server enforces it too - this only decides what to show.)
   * A session saved before privileges existed has no list yet, so it is allowed until refreshMe() fills it in.
   */
  can(permission: string): boolean {
    const p = this.currentUser()?.permissions;
    return p ? p.includes(permission) : true;
  }
  canAny(...permissions: string[]): boolean { return permissions.some(p => this.can(p)); }

  getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
  isLoggedIn(): boolean { return !!this.getToken(); }

  private store(res: LoginResponse) {
    localStorage.setItem(TOKEN_KEY, res.token);
    this.setUser({
      id: res.id, username: res.username, displayName: res.displayName, role: res.role,
      permissions: res.permissions, tenantId: res.tenantId, tenantName: res.tenantName
    });
  }

  private setUser(user: User) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  private loadUser(): User | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) as User : null;
    } catch { return null; }
  }
}
