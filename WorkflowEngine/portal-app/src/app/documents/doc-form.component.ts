import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ErpDataService } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { PortalApiService } from '../core/portal-api.service';
import { TranslatePipe } from '../core/translate.pipe';
import { CURRENCIES, DocTypeConfig, ITEM_CATALOG, PARTIES, VAT_RATE } from '../core/erp.config';
import { OrgService } from '../core/org.service';
import { DocLine } from '../core/models';
import { IconComponent, MoneyPipe } from '../shared/ui';
import { StepperComponent } from '../shared/erp-widgets';

interface EditLine extends DocLine { }

@Component({
  selector: 'app-doc-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, IconComponent, MoneyPipe, StepperComponent],
  template: `
    <ng-container *ngIf="dt() as dt">
      <div class="crumb">
        <a [routerLink]="['/m', dt.module]">{{ ('module.' + dt.module) | translate }}</a><span>/</span><span>{{ 'mod.new' | translate }}</span>
      </div>
      <div class="page-head">
        <div class="titles">
          <h1>{{ ('doc.' + dt.key) | translate }} <span class="mono num-tag">{{ number }}</span></h1>
          <p>{{ ('doc.' + dt.key + '.desc') | translate }}</p>
        </div>
      </div>

      <div class="warn" *ngIf="data.loadedOnce() && !definition()">
        <app-icon name="alert" [size]="16"></app-icon>{{ 'form.noWorkflow' | translate }}
      </div>

      <div class="layout">
        <div class="main">
          <!-- header -->
          <section class="card">
            <div class="card-head"><h3>{{ 'form.header' | translate }}</h3></div>
            <div class="card-body hdr">
              <div><label class="lbl">{{ 'form.company' | translate }}</label>
                <select [(ngModel)]="company" (ngModelChange)="onCompany()"><option *ngFor="let c of companies" [value]="c.code">{{ i18n.nm(c) }}</option></select></div>
              <div><label class="lbl">{{ 'form.branch' | translate }}</label>
                <select [(ngModel)]="branch" (ngModelChange)="onBranch()"><option *ngFor="let b of branchesFor()" [value]="b.code">{{ i18n.nm(b) }}</option></select></div>
              <div><label class="lbl">{{ 'form.date' | translate }}</label><input type="date" [(ngModel)]="docDate" /></div>

              <div *ngIf="dt.partyKind !== 'warehouse'">
                <label class="lbl">{{ ('party.' + dt.partyKind) | translate }} *</label>
                <input [(ngModel)]="party" list="parties" />
                <datalist id="parties"><option *ngFor="let p of parties()" [value]="p"></option></datalist>
              </div>
              <div><label class="lbl">{{ (dt.partyKind === 'warehouse' ? 'party.warehouse' : 'form.warehouse') | translate }}</label>
                <select [(ngModel)]="warehouse"><option *ngFor="let w of warehouses" [value]="w">{{ w }}</option></select></div>
              <div *ngIf="dt.needsToWarehouse"><label class="lbl">{{ 'form.toWarehouse' | translate }} *</label>
                <select [(ngModel)]="toWarehouse"><option *ngFor="let w of warehouses" [value]="w" [disabled]="w === warehouse">{{ w }}</option></select></div>

              <div><label class="lbl">{{ 'form.currency' | translate }}</label>
                <select [(ngModel)]="currency"><option *ngFor="let c of currencies" [value]="c">{{ c }}</option></select></div>
              <div><label class="lbl">{{ 'form.dueDate' | translate }}</label><input type="date" [(ngModel)]="dueDate" /></div>
              <div><label class="lbl">{{ 'form.costCenter' | translate }}</label><input [(ngModel)]="costCenter" placeholder="CC-100" /></div>
            </div>
          </section>

          <!-- lines -->
          <section class="card">
            <div class="card-head"><h3>{{ 'form.lines' | translate }}</h3>
              <button class="sm" (click)="addLine()"><app-icon name="plus" [size]="14"></app-icon>{{ 'form.addLine' | translate }}</button></div>
            <div class="table-wrap">
              <table class="data lines">
                <thead><tr>
                  <th style="width:32%">{{ 'form.item' | translate }}</th>
                  <th>{{ 'form.description' | translate }}</th>
                  <th class="num" style="width:90px">{{ 'form.qty' | translate }}</th>
                  <th style="width:80px">{{ 'form.unit' | translate }}</th>
                  <th class="num" style="width:130px">{{ 'form.unitPrice' | translate }}</th>
                  <th class="num" style="width:140px">{{ 'form.amount' | translate }}</th>
                  <th style="width:40px"></th>
                </tr></thead>
                <tbody>
                  <tr *ngFor="let l of lines; let i = index">
                    <td><input [(ngModel)]="l.item" (ngModelChange)="onItem(l)" list="catalog" [placeholder]="'form.item' | translate" /></td>
                    <td><input [(ngModel)]="l.description" /></td>
                    <td><input type="number" min="0" class="r" [(ngModel)]="l.qty" (ngModelChange)="recalc(l)" /></td>
                    <td><input [(ngModel)]="l.unit" /></td>
                    <td><input type="number" min="0" step="0.01" class="r" [(ngModel)]="l.unitPrice" (ngModelChange)="recalc(l)" /></td>
                    <td class="num strong">{{ l.amount | money:currency }}</td>
                    <td><button class="ghost sm" (click)="removeLine(i)" [disabled]="lines.length === 1"><app-icon name="trash" [size]="14"></app-icon></button></td>
                  </tr>
                </tbody>
              </table>
              <datalist id="catalog"><option *ngFor="let c of catalog" [value]="c.name">{{ c.sku }}</option></datalist>
            </div>
          </section>

          <section class="card">
            <div class="card-body"><label class="lbl">{{ 'form.notes' | translate }}</label><textarea rows="3" [(ngModel)]="notes"></textarea></div>
          </section>
        </div>

        <!-- totals + route -->
        <aside class="side">
          <section class="card sticky">
            <div class="card-body totals">
              <div class="row"><span>{{ 'form.subtotal' | translate }}</span><span>{{ subtotal | money:currency }}</span></div>
              <div class="row" *ngIf="dt.hasDiscount">
                <span>{{ 'form.discount' | translate }}</span>
                <input type="number" min="0" max="100" class="pct" [(ngModel)]="discountPct" />
              </div>
              <div class="hint" *ngIf="dt.hasDiscount">{{ 'form.discountHint' | translate }}</div>
              <div class="row" *ngIf="dt.hasDiscount && discountAmount"><span class="dim">−</span><span class="dim">{{ discountAmount | money:currency }}</span></div>
              <div class="row" *ngIf="dt.hasVat"><span>{{ 'form.vat' | translate }} ({{ vatRate }}%)</span><span>{{ vatAmount | money:currency }}</span></div>
              <div class="row grand"><span>{{ 'form.total' | translate }}</span><span>{{ total | money:currency }}</span></div>

              <p class="err" *ngIf="error">{{ error }}</p>
              <button class="primary submit" (click)="submit()" [disabled]="saving || !definition()">
                <app-icon name="send" [size]="15"></app-icon>{{ (saving ? 'form.saving' : 'form.submit') | translate }}
              </button>
            </div>
            <div class="card-body route">
              <label class="lbl">{{ 'form.route' | translate }}</label>
              <app-stepper [stages]="dt.stages" current="request" status="pending" [vertical]="true"></app-stepper>
              <ul class="route-steps" *ngIf="definition()?.nodes as nodes">
                <li *ngFor="let n of taskNodes(nodes)"><app-icon name="check-square" [size]="13"></app-icon>{{ n.name }} <span class="dim">· {{ n.assignee }}</span></li>
              </ul>
            </div>
          </section>
        </aside>
      </div>
    </ng-container>
  `,
  styles: [`
    .num-tag { font-size: 13px; font-weight: 600; color: var(--primary); background: var(--primary-soft); padding: 3px 8px; border-radius: 6px; vertical-align: middle; margin-inline-start: 8px; }
    .warn { display: flex; gap: 8px; align-items: center; background: var(--warn-soft); color: var(--warn); padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; }
    .layout { display: grid; grid-template-columns: 1fr 330px; gap: 18px; align-items: start; }
    .main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
    .hdr { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .lines td { padding: 6px 8px; }
    .lines input { padding: 7px 8px; }
    .r { text-align: end; }
    .strong { font-weight: 600; }
    .sticky { position: sticky; top: 78px; }
    .totals { display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-variant-numeric: tabular-nums; }
    .pct { width: 80px; text-align: end; }
    .hint { font-size: 11.5px; color: var(--text-dim); margin-top: -4px; }
    .grand { border-top: 1px dashed var(--border-strong); padding-top: 12px; font-size: 18px; font-weight: 700; }
    .submit { width: 100%; padding: 11px; margin-top: 6px; }
    .err { color: var(--bad); font-size: 12.5px; margin: 0; }
    .route { border-top: 1px solid var(--border); }
    .route-steps { list-style: none; padding: 0; margin: 14px 0 0; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
    .route-steps li { display: flex; gap: 6px; align-items: center; color: var(--text-2); }
    @media (max-width: 1050px) { .layout { grid-template-columns: 1fr; } .sticky { position: static; } }
    @media (max-width: 700px) { .hdr { grid-template-columns: 1fr; } }
  `]
})
export class DocFormComponent implements OnInit {
  get companies() { return this.org.companies(); }
  get warehouses() { return this.org.warehouses(); }
  currencies = CURRENCIES;
  catalog = ITEM_CATALOG;
  vatRate = VAT_RATE;

  dt = signal<DocTypeConfig | undefined>(undefined);
  definition = computed(() => { const d = this.dt(); return d ? this.data.definitionFor(d) : undefined; });
  parties = computed(() => !this.dt() ? [] : this.dt()!.partyKind === 'warehouse' ? this.org.warehouses() : PARTIES[this.dt()!.partyKind]);

  number = '';
  company = 'MAIN';
  branch = '';
  warehouse = '';
  toWarehouse = '';
  docDate = new Date().toISOString().slice(0, 10);
  dueDate = '';
  party = '';
  currency = 'SAR';
  costCenter = '';
  notes = '';
  discountPct = 0;
  lines: EditLine[] = [];
  saving = false;
  error = '';

  constructor(private route: ActivatedRoute, private router: Router, public data: ErpDataService, private ctx: ErpContextService,
              private auth: AuthService, public i18n: I18nService, private api: PortalApiService, private org: OrgService) {}

  ngOnInit() {
    const dt = this.data.docTypeByKey(this.route.snapshot.paramMap.get('docType'));
    if (!dt) { this.router.navigate(['/dashboard']); return; }
    this.dt.set(dt);
    this.company = this.ctx.company();
    const b = this.ctx.defaultBranch();
    this.branch = b.code;
    this.warehouse = b.warehouse;
    this.toWarehouse = this.org.warehouses().find(w => w !== b.warehouse) ?? this.org.warehouses()[0] ?? '';
    this.currency = this.ctx.companyObj().currency;
    if (dt.partyKind === 'employee') this.party = this.auth.currentUser()?.displayName ?? '';
    this.addLine();
    const ready = () => { this.number = this.data.nextNumber(dt); };
    if (this.data.loadedOnce()) ready(); else this.data.refresh().subscribe(ready);
  }

  branchesFor() { return this.org.branchesOf(this.company); }
  onCompany() { const b = this.branchesFor()[0]; if (b) { this.branch = b.code; this.warehouse = b.warehouse; } }
  onBranch() { const b = this.org.branch(this.branch); if (b) this.warehouse = b.warehouse; }

  addLine() { this.lines.push({ item: '', description: '', qty: 1, unit: '', unitPrice: 0, amount: 0 }); }
  removeLine(i: number) { this.lines.splice(i, 1); }

  onItem(l: EditLine) {
    const c = ITEM_CATALOG.find(x => x.name === l.item);
    if (c) { l.unit = c.unit; if (!l.unitPrice) l.unitPrice = c.price; if (!l.description) l.description = c.sku; this.recalc(l); }
  }
  recalc(l: EditLine) { l.amount = Math.round((+l.qty || 0) * (+l.unitPrice || 0) * 100) / 100; }

  get subtotal() { return this.lines.reduce((s, l) => s + (l.amount || 0), 0); }
  get discountAmount() { return this.dt()?.hasDiscount ? Math.round(this.subtotal * (+this.discountPct || 0)) / 100 : 0; }
  get vatAmount() { return this.dt()?.hasVat ? Math.round((this.subtotal - this.discountAmount) * this.vatRate) / 100 : 0; }
  get total() { return Math.round((this.subtotal - this.discountAmount + this.vatAmount) * 100) / 100; }

  taskNodes(nodes: { type: string; name: string; assignee?: string }[]) {
    return nodes.filter(n => n.type === 'ApprovalTask' || n.type === 'FormTask');
  }

  submit() {
    const dt = this.dt();
    const def = this.definition();
    if (!dt || !def) return;
    const validLines = this.lines.filter(l => l.item && +l.qty > 0 && +l.unitPrice >= 0 && l.amount > 0);
    const needsParty = dt.partyKind !== 'warehouse';
    if ((needsParty && !this.party.trim()) || !validLines.length || (dt.needsToWarehouse && this.toWarehouse === this.warehouse)) {
      this.error = this.i18n.t('form.invalid');
      return;
    }
    this.error = '';
    this.saving = true;

    const user = this.auth.currentUser();
    const initialData: Record<string, any> = {
      docType: dt.key,
      docNumber: this.number,
      module: dt.module,
      company: this.company,
      branch: this.branch,
      warehouse: this.warehouse,
      toWarehouse: dt.needsToWarehouse ? this.toWarehouse : undefined,
      docDate: this.docDate,
      dueDate: this.dueDate || undefined,
      party: needsParty ? this.party.trim() : `${this.warehouse} → ${this.toWarehouse}`,
      currency: this.currency,
      costCenter: this.costCenter || undefined,
      notes: this.notes || undefined,
      lines: validLines.map(l => ({ item: l.item, description: l.description, qty: +l.qty, unit: l.unit, unitPrice: +l.unitPrice, amount: l.amount })),
      subtotal: this.subtotal,
      discountPct: dt.hasDiscount ? (+this.discountPct || 0) : 0,
      discountAmount: this.discountAmount,
      vatPct: dt.hasVat ? this.vatRate : 0,
      vatAmount: this.vatAmount,
      total: this.total,
      requesterName: user?.displayName,
      employeeName: dt.partyKind === 'employee' ? this.party : undefined,
      vendor: dt.partyKind === 'vendor' ? this.party : undefined,
    };
    Object.keys(initialData).forEach(k => initialData[k] === undefined && delete initialData[k]);

    this.api.startInstance(def.id, initialData).subscribe({
      next: inst => {
        this.saving = false;
        this.data.refresh().subscribe();
        this.router.navigate(['/documents', inst.id]);
      },
      error: err => { this.saving = false; this.error = typeof err?.error === 'string' ? err.error : (err?.message ?? 'Error'); }
    });
  }
}
