import { defaultCurrency } from '../core/region';
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { OrgService } from '../core/org.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { WebsiteService } from './website.service';
import { SiteRow, Submission, TemplateKey, templateDesign } from './website.models';

/** Websites: list of sites (create from a template, open the designer, publish status) + the orders and messages visitors sent. */
@Component({
  selector: 'app-website-home',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LocalDatePipe],
  template: `
    <div class="page-head"><div class="titles"><h1>{{ 'module.website' | translate }}</h1><p>{{ 'web.sub' | translate }}</p></div>
      <button class="primary" *ngIf="auth.can('web.edit')" (click)="openNew()"><app-icon name="plus" [size]="15"></app-icon>{{ 'web.newSite' | translate }}</button></div>
    <div class="tabs">
      <button [class.on]="tab() === 'sites'" (click)="tab.set('sites')">{{ 'web.sites' | translate }}</button>
      <button *ngIf="auth.can('web.orders.manage')" [class.on]="tab() === 'orders'" (click)="tab.set('orders'); loadSubs()">{{ 'web.orders' | translate }} <b class="badge" *ngIf="newCount()">{{ newCount() }}</b></button>
    </div>
    <div class="flash bad" *ngIf="error">{{ error }}</div>

    <div class="sites" *ngIf="tab() === 'sites'">
      <div class="card site" *ngFor="let s of sites()">
        <div class="thumb"><app-icon name="globe" [size]="34"></app-icon></div>
        <h3>{{ s.name }}</h3>
        <div class="dim">{{ (s.published ? 'web.live' : 'web.draft') | translate }} · {{ s.updatedAt | ldate }}</div>
        <a *ngIf="s.published" class="mono url" [href]="web.publicUrl(s.slug)" target="_blank" rel="noopener">{{ web.publicUrl(s.slug) }}</a>
        <div class="acts">
          <button class="primary sm" (click)="open(s)"><app-icon name="edit" [size]="14"></app-icon>{{ (auth.can('web.edit') ? 'web.design' : 'web.view') | translate }}</button>
          <button class="ghost sm danger-i" *ngIf="auth.can('web.publish')" (click)="del = s" [title]="'common.delete' | translate"><app-icon name="trash" [size]="15"></app-icon></button>
        </div>
      </div>
      <div class="empty" *ngIf="loaded() && !sites().length">{{ 'web.none' | translate }}</div>
    </div>

    <div class="card" *ngIf="tab() === 'orders'">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>#</th><th>{{ 'web.site' | translate }}</th><th>{{ 'web.customer' | translate }}</th><th>{{ 'web.details' | translate }}</th><th>{{ 'bill.total' | translate }}</th><th>{{ 'admin.status' | translate }}</th></tr></thead>
        <tbody>
          <tr *ngFor="let o of subs()">
            <td class="mono">{{ o.number }}<div class="dim" style="font-size:11px">{{ o.createdAt | ldate }}</div></td>
            <td>{{ siteName(o.siteId) }}</td>
            <td><strong>{{ o.name }}</strong><div class="dim">{{ o.phone }} {{ o.email }}</div><div class="dim" *ngIf="o.address">{{ o.address }}</div></td>
            <td><ng-container *ngIf="o.kind === 'order'"><div *ngFor="let l of o.lines">{{ l.qty }} × {{ l.name }}</div></ng-container><div *ngIf="o.kind === 'message'">{{ o.note }}</div><div class="dim" *ngIf="o.kind === 'order' && o.note">{{ o.note }}</div></td>
            <td>{{ o.kind === 'order' ? (o.total | number:'1.2-2') + ' ' + o.currency : '—' }}</td>
            <td><select [ngModel]="o.status" (ngModelChange)="status(o, $event)"><option *ngFor="let s of statuses" [value]="s">{{ 'web.st.' + s | translate }}</option></select></td>
          </tr>
        </tbody></table></div>
      <div class="empty" *ngIf="!subs().length">{{ 'common.noData' | translate }}</div>
    </div>

    <div class="modal-scrim" *ngIf="nw" (click)="nw = null">
      <div class="modal" style="max-width:640px" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'web.newSite' | translate }}</h3><button class="ghost icon-btn" (click)="nw = null"><app-icon name="x"></app-icon></button></div>
        <div class="modal-body">
          <label class="lbl">{{ 'web.siteName' | translate }}</label><input [(ngModel)]="nw.name" />
          <label class="lbl" style="margin-top:12px">{{ 'web.template' | translate }}</label>
          <div class="tpls"><button type="button" *ngFor="let t of tpls" [class.on]="nw.tpl === t.k" (click)="nw.tpl = t.k"><span>{{ t.i }}</span><strong>{{ t.l | translate }}</strong><small class="dim">{{ t.d | translate }}</small></button></div>
          <p class="flash bad" *ngIf="error">{{ error }}</p>
        </div>
        <div class="modal-foot"><button (click)="nw = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="create()" [disabled]="busy || !nw.name.trim()">{{ 'web.create' | translate }}</button></div>
      </div>
    </div>
    <div class="modal-scrim" *ngIf="del" (click)="del = null">
      <div class="modal" style="max-width:440px" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'common.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'web.deleteAsk' | translate: { n: del.name } }}</p></div>
        <div class="modal-foot"><button (click)="del = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doDelete()">{{ 'common.delete' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .sites { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .site { padding: 16px; display: flex; flex-direction: column; gap: 6px; } .site h3 { margin: 4px 0 0; }
    .thumb { height: 110px; border-radius: 10px; background: linear-gradient(135deg, #6366f1, #0ea5a4); color: #fff; display: grid; place-items: center; }
    .url { font-size: 12px; word-break: break-all; } .acts { display: flex; gap: 8px; margin-top: 8px; }
    .tpls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 6px; }
    .tpls button { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; padding: 12px; border: 2px solid var(--line, #ddd); border-radius: 12px; background: transparent; cursor: pointer; text-align: start; color: inherit; }
    .tpls button.on { border-color: var(--brand, #4f46e5); } .tpls span { font-size: 26px; }
    @media (max-width: 640px) { .tpls { grid-template-columns: 1fr; } }
  `]
})
export class WebsiteHomeComponent implements OnInit {
  tab = signal<'sites' | 'orders'>('sites');
  sites = signal<SiteRow[]>([]); subs = signal<Submission[]>([]); loaded = signal(false);
  nw: { name: string; tpl: TemplateKey } | null = null; del: SiteRow | null = null; busy = false; error = '';
  statuses = ['new', 'confirmed', 'shipped', 'done', 'cancelled'];
  tpls: { k: TemplateKey; i: string; l: string; d: string }[] = [
    { k: 'blank', i: '📄', l: 'web.t.blank', d: 'web.t.blankD' }, { k: 'business', i: '🏢', l: 'web.t.business', d: 'web.t.businessD' }, { k: 'shop', i: '🛍️', l: 'web.t.shop', d: 'web.t.shopD' }];
  newCount = () => this.subs().filter(s => s.status === 'new').length;

  constructor(public web: WebsiteService, public auth: AuthService, private router: Router, private org: OrgService, private i18n: I18nService) {}
  ngOnInit() {
    this.load();
    if (this.auth.can('web.orders.manage')) this.loadSubs();
  }
  load() { this.web.list().subscribe({ next: l => { this.sites.set(l); this.loaded.set(true); }, error: () => this.loaded.set(true) }); }
  loadSubs() { this.web.submissions().subscribe(l => this.subs.set(l)); }
  siteName(id: string) { return this.sites().find(s => s.id === id)?.name ?? ''; }
  open(s: SiteRow) { this.router.navigate(['/website', s.id]); }
  openNew() { this.error = ''; this.nw = { name: '', tpl: 'shop' }; }
  create() {
    if (!this.nw) return;
    this.busy = true; this.error = '';
    const cur = this.org.companies()[0]?.currency ?? defaultCurrency();
    const name = this.nw.name.trim();
    const design = templateDesign(this.nw.tpl, name, cur);
    this.web.create(name, design, cur).subscribe({
      next: s => { this.busy = false; this.nw = null; this.router.navigate(['/website', s.id]); },
      error: e => { this.busy = false; this.error = typeof e.error === 'string' && e.error ? e.error : this.i18n.t('common.error'); }
    });
  }
  doDelete() { if (!this.del) return; const id = this.del.id; this.del = null; this.web.remove(id).subscribe(() => this.load()); }
  status(o: Submission, s: string) { this.web.setStatus(o.id, s).subscribe(() => o.status = s); }
}
