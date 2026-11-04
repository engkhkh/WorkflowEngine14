import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { OrgService } from '../core/org.service';
import { FinRec, JournalLine, JOURNAL_STATUSES } from '../core/fin.models';
import { round2 } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe, StatusComponent } from '../shared/ui';
import { FinHistoryComponent } from './fin-audit.component';
import { errMsg, finPill, recLabel, todayStr } from './fin-util';

interface JForm {
  id: string; code: string; status: string; date: string; memo: string; reference: string; currency: string; rate: number;
  lines: JournalLine[]; reverses?: string; createdBy?: string | null; approvedBy?: string | null;
}

/**
 * General ledger journals: draft -> submitted -> posted (or rejected), with balanced-entry checks, multi-currency, cost centre /
 * project / intercompany dimensions, approval, reversal and history.
 * Privileges: finance.gl.view (read), finance.gl.manage (create / edit drafts / submit), finance.gl.approve (post, reject, reverse).
 */
@Component({
  selector: 'app-fin-journals',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, NumPipe, LocalDatePipe, StatusComponent, FinHistoryComponent],
  template: `
    <div class="bar">
      <input class="search" [placeholder]="'common.search' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <select [ngModel]="status()" (ngModelChange)="status.set($event)">
        <option value="">{{ 'fin.allStatus' | translate }}</option>
        <option *ngFor="let s of statuses" [value]="s">{{ 'fin.st.' + s | translate }}</option>
      </select>
      <span class="grow"></span>
      <button class="primary" *ngIf="canManage" (click)="openNew()"><app-icon name="plus" [size]="15"></app-icon>{{ 'fin.jv.new' | translate }}</button>
    </div>
    <p class="flash good" *ngIf="msg">{{ msg }}</p>
    <p class="flash bad" *ngIf="error && !form">{{ error }}</p>

    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'fin.f.number' | translate }}</th><th>{{ 'fin.f.date' | translate }}</th><th>{{ 'fin.f.memo' | translate }}</th>
        <th class="num">{{ 'fin.f.amount' | translate }}</th><th>{{ 'fin.f.status' | translate }}</th><th>{{ 'fin.f.createdBy' | translate }}</th><th></th></tr></thead>
      <tbody>
        <tr *ngFor="let r of shown()">
          <td class="mono"><a class="lnk" (click)="open(r)">{{ r.code }}</a></td>
          <td>{{ r.data['date'] | ldate }}</td>
          <td class="memo">{{ r.data['memo'] }}<span class="dim" *ngIf="r.data['reverses']"> ↩ {{ r.data['reverses'] }}</span></td>
          <td class="num">{{ total(r) | num: 2 }} <small class="dim">{{ r.data['currency'] || base() }}</small></td>
          <td><app-status [status]="pill(r.status)" [label]="stLabel(r.status)"></app-status></td>
          <td class="dim">{{ r.createdBy }}</td>
          <td class="act">
            <button class="sm" *ngIf="canApprove && r.status === 'Submitted'" (click)="act(r, 'Posted')">{{ 'fin.jv.post' | translate }}</button>
            <button class="ghost sm danger-i" *ngIf="canApprove && r.status === 'Submitted'" (click)="act(r, 'Rejected')">{{ 'fin.jv.reject' | translate }}</button>
            <button class="ghost sm" *ngIf="canApprove && r.status === 'Posted'" (click)="reverse(r)">{{ 'fin.jv.reverse' | translate }}</button>
            <button class="ghost sm" *ngIf="canAudit" (click)="history = r" [title]="'fin.audit.history' | translate"><app-icon name="clock" [size]="15"></app-icon></button>
            <button class="ghost sm" *ngIf="canManage && editable(r)" (click)="open(r)" [title]="'admin.edit' | translate"><app-icon name="edit" [size]="15"></app-icon></button>
            <button class="ghost sm danger-i" *ngIf="canManage && (r.status === 'Draft' || r.status === 'Rejected')" (click)="deleting = r" [title]="'admin.delete' | translate"><app-icon name="trash" [size]="15"></app-icon></button>
          </td>
        </tr>
      </tbody>
    </table><div class="empty" *ngIf="!shown().length">{{ 'fin.jv.none' | translate }}</div></div></div>

    <!-- editor -->
    <div class="modal-scrim" *ngIf="form" (click)="close()">
      <div class="modal wide" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ form.code ? form.code : ('fin.jv.new' | translate) }}
          <app-status *ngIf="form.id" [status]="pill(form.status)" [label]="stLabel(form.status)"></app-status></h3></div>
        <div class="modal-body">
          <div class="head-grid">
            <div><label class="lbl">{{ 'fin.f.date' | translate }} *</label><input type="date" [(ngModel)]="form.date" [disabled]="ro()" /></div>
            <div><label class="lbl">{{ 'fin.f.reference' | translate }}</label><input [(ngModel)]="form.reference" [disabled]="ro()" /></div>
            <div><label class="lbl">{{ 'fin.f.currency' | translate }}</label>
              <select [ngModel]="form.currency" (ngModelChange)="setCurrency($event)" [disabled]="ro()">
                <option [value]="base()">{{ base() }}</option><option *ngFor="let c of currencies()" [value]="c.code!">{{ c.code }}</option></select></div>
            <div><label class="lbl">{{ 'fin.f.rate' | translate }}</label><input type="number" step="0.0001" [(ngModel)]="form.rate" [disabled]="ro() || form.currency === base()" /></div>
            <div class="wide2"><label class="lbl">{{ 'fin.f.memo' | translate }}</label><input [(ngModel)]="form.memo" [disabled]="ro()" /></div>
          </div>

          <div class="lines"><table class="data">
            <thead><tr><th>{{ 'fin.f.account' | translate }}</th><th class="num">{{ 'fin.jv.debit' | translate }}</th><th class="num">{{ 'fin.jv.credit' | translate }}</th>
              <th>{{ 'fin.f.costCenter' | translate }}</th><th>{{ 'fin.f.project' | translate }}</th><th *ngIf="companies().length > 1">{{ 'fin.jv.ic' | translate }}</th><th>{{ 'fin.f.memo' | translate }}</th><th></th></tr></thead>
            <tbody><tr *ngFor="let l of form.lines; let i = index">
              <td><select [(ngModel)]="l.account" [disabled]="ro()"><option value="">—</option><option *ngFor="let a of accounts()" [value]="a.code!">{{ label(a) }}</option></select></td>
              <td><input class="amt" type="number" step="0.01" min="0" [(ngModel)]="l.debit" (ngModelChange)="l.credit = l.debit ? 0 : l.credit" [disabled]="ro()" /></td>
              <td><input class="amt" type="number" step="0.01" min="0" [(ngModel)]="l.credit" (ngModelChange)="l.debit = l.credit ? 0 : l.debit" [disabled]="ro()" /></td>
              <td><select [(ngModel)]="l.costCenter" [disabled]="ro()"><option value="">—</option><option *ngFor="let c of costCenters()" [value]="c.code!">{{ label(c) }}</option></select></td>
              <td><select [(ngModel)]="l.project" [disabled]="ro()"><option value="">—</option><option *ngFor="let p of projects()" [value]="p.code!">{{ label(p) }}</option></select></td>
              <td *ngIf="companies().length > 1"><select [(ngModel)]="l.icPartner" [disabled]="ro()"><option value="">—</option><option *ngFor="let c of otherCompanies()" [value]="c.code">{{ c.code }}</option></select></td>
              <td><input [(ngModel)]="l.memo" [disabled]="ro()" /></td>
              <td><button class="ghost sm danger-i" *ngIf="!ro() && form.lines.length > 2" (click)="form.lines.splice(i, 1)"><app-icon name="trash" [size]="14"></app-icon></button></td>
            </tr></tbody>
            <tfoot><tr><td><button class="ghost sm" *ngIf="!ro()" (click)="addLine()"><app-icon name="plus" [size]="14"></app-icon>{{ 'fin.jv.addLine' | translate }}</button></td>
              <td class="num"><strong>{{ debit() | num: 2 }}</strong></td><td class="num"><strong>{{ credit() | num: 2 }}</strong></td>
              <td colspan="5"><span class="bal" [class.ok]="balanced()" [class.bad]="!balanced()">{{ balanced() ? ('fin.jv.balanced' | translate) : ('fin.jv.diff' | translate: { n: (diff() | num: 2) }) }}</span></td></tr></tfoot>
          </table></div>
          <p class="dim" *ngIf="form.status === 'Posted'">{{ 'fin.jv.postedHint' | translate }} <span *ngIf="form.approvedBy">· {{ 'fin.f.approvedBy' | translate }}: {{ form.approvedBy }}</span></p>
          <p class="flash bad" *ngIf="error">{{ error }}</p>
        </div>
        <div class="modal-foot">
          <button (click)="close()">{{ 'hr.imp.close' | translate }}</button>
          <ng-container *ngIf="!ro()">
            <button (click)="save('Draft')" [disabled]="saving">{{ 'fin.jv.saveDraft' | translate }}</button>
            <button class="primary" (click)="save('Submitted')" [disabled]="saving">{{ 'fin.jv.submit' | translate }}</button>
            <button class="primary" *ngIf="canApprove" (click)="save('Posted')" [disabled]="saving">{{ 'fin.jv.postNow' | translate }}</button>
          </ng-container>
        </div>
      </div>
    </div>

    <div class="modal-scrim" *ngIf="deleting" (click)="deleting = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'admin.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'fin.deleteConfirm' | translate: { name: deleting.code || '' } }}</p><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="deleting = null">{{ 'common.cancel' | translate }}</button><button class="primary danger-fill" (click)="doDelete()">{{ 'admin.delete' | translate }}</button></div>
      </div>
    </div>

    <app-fin-history *ngIf="history" kind="journal" [recordId]="history.id" [title]="history.code || ''" (closed)="history = null"></app-fin-history>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; } .search { max-width: 260px; } .bar select { width: auto; } .grow { flex: 1; }
    .lnk { cursor: pointer; color: var(--primary); } .memo { max-width: 340px; } .act { white-space: nowrap; text-align: end; }
    .danger-i { color: var(--bad); } .danger-fill { background: var(--bad); border-color: var(--bad); color: #fff; }
    .modal.wide { width: min(1080px, 100%); }
    .head-grid { display: grid; grid-template-columns: 150px 1fr 120px 120px; gap: 10px 14px; margin-bottom: 14px; } .wide2 { grid-column: 1 / -1; }
    .lines { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
    .lines td { padding: 6px 8px; } .lines select, .lines input { min-width: 100px; } .lines .amt { min-width: 110px; text-align: end; }
    tfoot td { background: var(--surface-2); }
    .bal { font-weight: 650; font-size: 12.5px; } .bal.ok { color: var(--ok); } .bal.bad { color: var(--bad); }
    @media (max-width: 760px) { .head-grid { grid-template-columns: 1fr 1fr; } }
  `]
})
export class FinJournalsComponent implements OnInit {
  auth = inject(AuthService); ctx = inject(ErpContextService); private fin = inject(FinService); private i18n = inject(I18nService);
  private org = inject(OrgService); private route = inject(ActivatedRoute); private router = inject(Router);

  statuses = JOURNAL_STATUSES;
  all = signal<FinRec[]>([]);
  q = signal(''); status = signal('');
  form: JForm | null = null; deleting: FinRec | null = null; history: FinRec | null = null;
  saving = false; error = ''; msg = '';

  canManage = this.auth.can('finance.gl.manage');
  canApprove = this.auth.can('finance.gl.approve');
  canAudit = this.auth.can('finance.audit.view');

  base = computed(() => this.ctx.companyObj().currency);
  companies = computed(() => this.org.companies());
  otherCompanies = computed(() => this.org.companies().filter(c => c.code !== this.ctx.company()));
  accounts = computed(() => this.fin.ref('account').filter(a => !a.data?.['isHeader'] && a.status !== 'Inactive').sort((x, y) => (x.code ?? '').localeCompare(y.code ?? '')));
  costCenters = computed(() => this.fin.ref('costcenter').filter(c => c.status !== 'Inactive'));
  projects = computed(() => this.fin.ref('project').filter(c => c.status !== 'Closed' && c.status !== 'Inactive'));
  currencies = computed(() => this.fin.ref('currency').filter(c => c.code !== this.base()));

  shown = () => {
    const q = this.q().toLowerCase().trim(), st = this.status();
    return this.all().filter(r => (!st || r.status === st) && (!q || `${r.code} ${r.data['memo']} ${r.data['reference']} ${r.createdBy}`.toLowerCase().includes(q)));
  };

  ngOnInit() {
    this.load(true);
  }

  load(first = false) {
    this.fin.records('journal', this.ctx.company()).subscribe({
      next: l => {
        this.all.set(l);
        if (first) {
          const qp = this.route.snapshot.queryParamMap;
          if (qp.get('new') && this.canManage) this.openNew();
          if (qp.keys.length) this.router.navigate([], { queryParams: {}, replaceUrl: true });
        }
      },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  label(r: FinRec) { return recLabel(r, this.i18n); }
  pill(s: string | null | undefined) { return finPill(s); }
  stLabel(s: string | null | undefined) { return this.i18n.t('fin.st.' + s); }
  total(r: FinRec) { return round2(((r.data['lines'] as JournalLine[] | undefined) ?? []).reduce((s, l) => s + (Number(l.debit) || 0), 0)); }
  editable(r: FinRec) { return r.status === 'Draft' || r.status === 'Rejected'; }
  ro() { return !this.canManage || (!!this.form && !['', 'Draft', 'Rejected'].includes(this.form.status)); }

  debit = () => round2((this.form?.lines ?? []).reduce((s, l) => s + (Number(l.debit) || 0), 0));
  credit = () => round2((this.form?.lines ?? []).reduce((s, l) => s + (Number(l.credit) || 0), 0));
  diff = () => round2(Math.abs(this.debit() - this.credit()));
  balanced = () => this.debit() > 0 && this.diff() < 0.005;

  blankLine(): JournalLine { return { account: '', debit: 0, credit: 0, costCenter: '', project: '', memo: '', icPartner: '' }; }
  addLine() { this.form!.lines.push(this.blankLine()); }

  openNew() {
    this.error = '';
    this.form = { id: '', code: '', status: '', date: todayStr(), memo: '', reference: '', currency: this.base(), rate: 1, lines: [this.blankLine(), this.blankLine()] };
  }
  open(r: FinRec) {
    this.error = '';
    const d = r.data ?? {};
    this.form = {
      id: r.id, code: r.code ?? '', status: r.status ?? 'Draft', date: String(d['date'] ?? '').slice(0, 10), memo: d['memo'] ?? '', reference: d['reference'] ?? '',
      currency: d['currency'] || this.base(), rate: Number(d['rate']) || 1, reverses: d['reverses'], createdBy: r.createdBy, approvedBy: r.approvedBy,
      lines: ((d['lines'] as JournalLine[] | undefined) ?? []).map(l => ({ ...this.blankLine(), ...l }))
    };
    if (this.form.lines.length < 2) while (this.form.lines.length < 2) this.form.lines.push(this.blankLine());
  }
  close() { this.form = null; }

  setCurrency(c: string) {
    const f = this.form!;
    f.currency = c;
    if (c === this.base()) { f.rate = 1; return; }
    const cur = this.fin.ref('currency').find(x => x.code === c);
    const base = this.fin.ref('currency').find(x => x.code === this.base());
    const r = Number(cur?.data?.['rate']);
    if (r > 0) f.rate = round2((r / (Number(base?.data?.['rate']) || 1)) * 10000) / 10000;
  }

  /** the JSON the server stores */
  private payload(status: string) {
    const f = this.form!;
    const lines = f.lines.filter(l => l.account || Number(l.debit) || Number(l.credit)).map(l => ({
      account: l.account, debit: round2(Number(l.debit) || 0), credit: round2(Number(l.credit) || 0),
      costCenter: l.costCenter || '', project: l.project || '', memo: l.memo || '', icPartner: l.icPartner || ''
    }));
    return {
      company: this.ctx.company(), status,
      data: { date: f.date, memo: f.memo, reference: f.reference, currency: f.currency, rate: f.currency === this.base() ? 1 : Number(f.rate) || 1, lines, reverses: f.reverses ?? '' }
    };
  }

  save(status: 'Draft' | 'Submitted' | 'Posted') {
    const f = this.form!;
    this.error = '';
    if (!f.date) { this.error = this.i18n.t('fin.jv.needDate'); return; }
    if (status !== 'Draft' && !this.balanced()) { this.error = this.i18n.t('fin.jv.notBalanced'); return; }
    this.saving = true;
    const body = this.payload(status);
    const req = f.id ? this.fin.update('journal', f.id, body) : this.fin.create('journal', body);
    req.subscribe({
      next: () => { this.saving = false; this.form = null; this.flash(this.i18n.t(status === 'Posted' ? 'fin.jv.posted' : 'hr.saved')); this.load(); },
      error: e => { this.saving = false; this.error = errMsg(e, this.i18n); }
    });
  }

  act(r: FinRec, status: 'Posted' | 'Rejected') {
    this.error = '';
    this.fin.update('journal', r.id, { status, data: r.data }).subscribe({
      next: () => { this.flash(this.i18n.t(status === 'Posted' ? 'fin.jv.posted' : 'fin.jv.rejected')); this.load(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  /** A posted journal is never edited: post a mirror entry and mark the original reversed. */
  reverse(r: FinRec) {
    this.error = '';
    const d = r.data ?? {};
    const lines = ((d['lines'] as JournalLine[] | undefined) ?? []).map(l => ({ ...l, debit: Number(l.credit) || 0, credit: Number(l.debit) || 0 }));
    const body = { company: r.company ?? this.ctx.company(), status: 'Posted', data: { ...d, date: todayStr(), memo: this.i18n.t('fin.jv.reversalOf', { n: r.code ?? '' }), lines, reverses: r.code } };
    this.fin.create('journal', body).subscribe({
      next: () => this.fin.update('journal', r.id, { status: 'Reversed', data: r.data }).subscribe({
        next: () => { this.flash(this.i18n.t('fin.jv.reversed')); this.load(); }, error: e => this.error = errMsg(e, this.i18n)
      }),
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  doDelete() {
    const d = this.deleting!;
    this.fin.remove('journal', d.id).subscribe({
      next: () => { this.deleting = null; this.flash(this.i18n.t('hr.deleted')); this.load(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  flash(t: string) { this.msg = t; setTimeout(() => this.msg = '', 3000); }
}
