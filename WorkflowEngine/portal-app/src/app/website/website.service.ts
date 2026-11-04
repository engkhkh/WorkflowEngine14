import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { SiteDesign, SiteRow, Submission } from './website.models';

@Injectable({ providedIn: 'root' })
export class WebsiteService {
  private base = environment.apiBaseUrl + '/website';
  constructor(private http: HttpClient) {}

  /** address visitors use (the API server serves the published page) */
  publicUrl(slug: string): string { return new URL(environment.apiBaseUrl, location.href).origin + '/s/' + slug; }
  orderUrl(slug: string): string { return new URL(`${environment.apiBaseUrl}/public/sites/${slug}/orders`, location.href).href; }
  messageUrl(slug: string): string { return new URL(`${environment.apiBaseUrl}/public/sites/${slug}/messages`, location.href).href; }

  list(): Observable<SiteRow[]> { return this.http.get<SiteRow[]>(`${this.base}/sites`); }
  get(id: string): Observable<SiteRow & { design: SiteDesign }> { return this.http.get<SiteRow & { design: SiteDesign }>(`${this.base}/sites/${id}`); }
  create(name: string, design: SiteDesign, currency: string): Observable<SiteRow> { return this.http.post<SiteRow>(`${this.base}/sites`, { name, design, currency }); }
  save(id: string, name: string, design: SiteDesign): Observable<SiteRow> { return this.http.put<SiteRow>(`${this.base}/sites/${id}`, { name, design }); }
  remove(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/sites/${id}`); }
  publish(id: string, html: string, products: { sku: string; name: string; price: number }[], currency: string): Observable<SiteRow> {
    return this.http.post<SiteRow>(`${this.base}/sites/${id}/publish`, { html, products, currency });
  }
  unpublish(id: string): Observable<SiteRow> { return this.http.post<SiteRow>(`${this.base}/sites/${id}/unpublish`, {}); }
  submissions(siteId?: string): Observable<Submission[]> { return this.http.get<Submission[]>(`${this.base}/submissions`, { params: siteId ? { siteId } : {} }); }
  setStatus(id: string, status: string): Observable<unknown> { return this.http.put(`${this.base}/submissions/${id}`, { status }); }
}
