import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { ErpRec } from '../core/erp.models';
import { ProjectFin, projectFin } from '../core/erp.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';

/** What is ready to bill on each project (approved time + billable costs for time-and-material, achieved milestones for fixed / milestone) and one click to draft the customer invoice in Finance. */
@Component({
  selector: 'app-prj-billing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, NumPipe],
  template: `
    <p class="dim lead">{{ 'prj.bill.sub' | translate }}</p>
    <p class="flash good" *ngIf="msg">{{ msg }} <a *ngIf="auth.can('finance.ar.view')" routerLink="/finance/receivables">{{ 'prj.bill.open' | translate }}</a></p>
    <p class="flash bad" *ngIf="error && !target">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'prj.f.project' | translate }}</th><th>{{ 'prj.f.customer' | translate }}</th><th>{{ 'prj.f.billing' | translate }}</th><th class="num">{{ 'prj.bill.ready' | translate }}</th><th class="num">{{ 'prj.bill.billed' | translate }}</th><th></th></tr></thead>
      <tbody><tr *ngFor="let p of rows()"><td>{{ p.fin.code }} <small class="dim">{{ p.fin.name }}</small></td><td>{{ p.fin.customer || '—' }}</td><td>{{ 'prj.bm.' + p.model | translate }}</td>
        <td class="num"><b>{{ p.fin.ready | num: 2 }}</b></td><td class="num">{{ p.fin.billed | num: 2 }}</td>
        <td class="act"><button class="primary sm" [disabled]="p.fin.ready <= 0 || !p.fin.customer" (click)="open(p.rec)">{{ 'prj.bill.create' | translate }}</button></td></tr></tbody></table>
      <div class="empty" *ngIf="!rows().length">{{ 'prj.none' | translate }}</div></div></div>

    <div class="modal-scrim" *ngIf="target" (click)="target = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'prj.bill.create' | translate }} · {{ target.code }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'erp.f.date' | translate }}</label><input type="date" [(ngModel)]="date" /></div>
          <div><label class="lbl">{{ 'prj.bill.terms' | translate }}</label><input type="number" [(ngModel)]="terms" /></div>
          <div><label class="lbl">{{ 'crm.q.tax' | translate }}</label><input type="number" step="0.01" [(ngModel)]="tax" /></div></div>
          <p class="dim">{{ 'prj.bill.draftNote' | translate }}</p><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="target = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="bill()" [disabled]="busy">{{ 'prj.bill.create' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`.lead { margin: 0 0 14px; font-size: 13px; } .act { text-align: end; } small.dim { margin-inline-start: 6px; }`]
})
export class PrjBillingComponent implements OnInit {
  auth = inject(AuthService); private ctx = inject(ErpContextService); private erp = inject(ErpService); private fin = inject(FinService); private i18n = inject(I18nService);
  data = signal<{ p: ErpRec[]; t: ErpRec[]; c: ErpRec[]; m: ErpRec[]; k: ErpRec[] }>({ p: [], t: [], c: [], m: [], k: [] });
  rows = computed(() => this.data().p.map(rec => ({ rec, model: String(rec.data['billingModel'] || 'tm'), fin: projectFin(rec, this.data().t, this.data().c, this.data().m, this.data().k) as ProjectFin })));
  target: ErpRec | null = null; date = new Date().toISOString().slice(0, 10); terms = 30; tax = 15; busy = false; msg = ''; error = '';

  ngOnInit() { this.load(); this.fin.loadRefs(['setting'], this.ctx.company()).subscribe(); }
  load() {
    const co = this.ctx.company(); const q = { company: co, take: 5000 };
    const get = (k: any) => this.erp.records('prj', k, q);
    get('project').subscribe(p => this.data.update(d => ({ ...d, p })));
    get('timesheet').subscribe({ next: t => this.data.update(d => ({ ...d, t })), error: () => undefined });
    get('cost').subscribe({ next: c => this.data.update(d => ({ ...d, c })), error: () => undefined });
    get('milestone').subscribe({ next: m => this.data.update(d => ({ ...d, m })), error: () => undefined });
    get('task').subscribe({ next: k => this.data.update(d => ({ ...d, k })), error: () => undefined });
  }
  open(p: ErpRec) { this.target = p; this.error = ''; this.msg = ''; }
  bill() {
    this.busy = true; this.error = '';
    this.erp.bill(this.target!.id, { taxPct: Number(this.tax) || 0, date: this.date, termsDays: Number(this.terms) || 0 }).subscribe({
      next: r => { this.busy = false; this.target = null; this.msg = this.i18n.t('prj.bill.done', { code: r.invoice, total: r.total }); this.load(); },
      error: e => { this.busy = false; this.error = errMsg(e, this.i18n); }
    });
  }
}
