import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CalItem {
  id: string; kind: 'event' | 'meeting' | 'todo'; title: string; owner: string; start: string | null; end: string | null; status?: string | null; room?: string | null; occurrence?: boolean;
  data: { notes?: string; location?: string; allDay?: boolean; attendees?: string[]; guests?: string[]; repeat?: string; repeatUntil?: string | null; remind?: number | null; priority?: string; rsvp?: Record<string, string> };
}
export interface CalInput {
  kind: 'event' | 'meeting' | 'todo'; title: string; start?: string | null; end?: string | null; allDay?: boolean; notes?: string; location?: string;
  attendees?: string[]; guests?: string[]; repeat?: string; repeatUntil?: string | null; remindMinutes?: number | null; priority?: string; done?: boolean;
}
export interface CalPerson { username: string; displayName: string; }
export interface CalSettings { jitsiDomain: string; workStart: string; workEnd: string; }

/** Calendar API (privileges cal.* are checked on the server; so are ownership, invitations and room access). */
@Injectable({ providedIn: 'root' })
export class CalendarService {
  private http = inject(HttpClient);
  private base = environment.apiBaseUrl + '/calendar';
  events(from: Date, to: Date): Observable<CalItem[]> { return this.http.get<CalItem[]>(`${this.base}/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`); }
  todos(): Observable<CalItem[]> { return this.http.get<CalItem[]>(`${this.base}/todos`); }
  people(): Observable<CalPerson[]> { return this.http.get<CalPerson[]>(`${this.base}/people`); }
  create(i: CalInput): Observable<{ ev: CalItem; emailed: number }> { return this.http.post<any>(`${this.base}/events`, i); }
  update(id: string, i: CalInput): Observable<{ ev: CalItem; emailed: number }> { return this.http.put<any>(`${this.base}/events/${id}`, i); }
  remove(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/events/${id}`); }
  toggleDone(id: string): Observable<CalItem> { return this.http.post<CalItem>(`${this.base}/events/${id}/done`, {}); }
  rsvp(id: string, response: string): Observable<CalItem> { return this.http.post<CalItem>(`${this.base}/events/${id}/rsvp`, { response }); }
  freeBusy(users: string[], from: Date, to: Date): Observable<Record<string, { s: string; e: string }[]>> { return this.http.post<any>(`${this.base}/freebusy`, { users, from: from.toISOString(), to: to.toISOString() }); }
  instant(title: string, attendees: string[]): Observable<{ ev: CalItem; url: string }> { return this.http.post<any>(`${this.base}/meetings/instant`, { title, attendees }); }
  join(id: string): Observable<{ url: string; room: string; domain: string; title: string }> { return this.http.post<any>(`${this.base}/events/${id}/join`, {}); }
  settings(): Observable<CalSettings> { return this.http.get<CalSettings>(`${this.base}/settings`); }
  saveSettings(s: CalSettings): Observable<CalSettings> { return this.http.put<CalSettings>(`${this.base}/settings`, s); }
  icsUrl(id: string) { return `${this.base}/events/${id}/ics`; }
  downloadIcs(id: string): Observable<Blob> { return this.http.get(`${this.base}/events/${id}/ics`, { responseType: 'blob' }); }
}

export const CAL_NAV: { path: string; label: string; icon: string; any: string[] }[] = [
  { path: 'view', label: 'cal.nav.calendar', icon: 'clock', any: ['cal.view'] },
  { path: 'todos', label: 'cal.nav.todos', icon: 'check', any: ['cal.view'] },
  { path: 'settings', label: 'cal.nav.settings', icon: 'settings', any: ['cal.settings'] },
];
export const CAL_ANY = ['cal.view'];

/** local date helpers (the server stores UTC; the screen shows the user's own zone) */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const pad2 = (n: number) => String(n).padStart(2, '0');
/** value for <input type="datetime-local"> */
export const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
