import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonIcon, IonList, IonItem,
  IonInput, IonSelect, IonSelectOption, IonTextarea, IonFooter, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addCircleOutline, trashOutline, sendOutline, alertCircleOutline } from 'ionicons/icons';
import { ErpDataService } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { PortalApiService } from '../core/portal-api.service';
import { TranslatePipe } from '../core/translate.pipe';
import { CURRENCIES, DocTypeConfig, ITEM_CATALOG, PARTIES, VAT_RATE } from '../core/erp.config';
import { OrgService } from '../core/org.service';
import { DocLine } from '../core/models';
import { MoneyPipe } from '../shared/ui';

@Component({
  selector: 'app-doc-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, MoneyPipe,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonIcon, IonList, IonItem,
    IonInput, IonSelect, IonSelectOption, IonTextarea, IonFooter],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/new"></ion-back-button></ion-buttons>
        <ion-title>{{ dt() ? (('doc.' + dt()!.key) | translate) : '' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content *ngIf="dt() as dt">
      <div class="head">
        <span class="mono num-tag">{{ number }}</span>
        <p class="dim">{{ ('doc.' + dt.key + '.desc') | translate }}</p>
      </div>
      <div class="warn" *ngIf="data.loadedOnce() && !definition()"><ion-icon name="alert-circle-outline"></ion-icon>{{ 'form.noWorkflow' | translate }}</div>

      <div class="section-title">{{ 'form.header' | translate }}</div>
      <ion-list class="boxed" lines="full">
        <ion-item>
          <ion-select [label]="'form.company' | translate" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="company" (ionChange)="onCompany()">
            <ion-select-option *ngFor="let c of companies" [value]="c.code">{{ i18n.nm(c) }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-select [label]="'form.branch' | translate" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="branch" (ionChange)="onBranch()">
            <ion-select-option *ngFor="let b of branchesFor()" [value]="b.code">{{ i18n.nm(b) }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item *ngIf="dt.partyKind !== 'warehouse'">
          <ion-select *ngIf="parties().length" [label]="(('party.' + dt.partyKind) | translate) + ' *'" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="party">
            <ion-select-option *ngFor="let p of parties()" [value]="p">{{ p }}</ion-select-option>
          </ion-select>
          <ion-input *ngIf="!parties().length" [label]="(('party.' + dt.partyKind) | translate) + ' *'" labelPlacement="stacked" [(ngModel)]="party"></ion-input>
        </ion-item>
        <ion-item>
          <ion-select [label]="(dt.partyKind === 'warehouse' ? 'party.warehouse' : 'form.warehouse') | translate" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="warehouse">
            <ion-select-option *ngFor="let w of warehouses" [value]="w">{{ w }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item *ngIf="dt.needsToWarehouse">
          <ion-select [label]="('form.toWarehouse' | translate) + ' *'" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="toWarehouse">
            <ion-select-option *ngFor="let w of warehouses" [value]="w" [disabled]="w === warehouse">{{ w }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item><ion-input type="date" [label]="'form.date' | translate" labelPlacement="stacked" [(ngModel)]="docDate"></ion-input></ion-item>
        <ion-item>
          <ion-select [label]="'form.currency' | translate" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="currency">
            <ion-select-option *ngFor="let c of currencies" [value]="c">{{ c }}</ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>

      <div class="section-title">{{ 'form.lines' | translate }}</div>
      <div class="line" *ngFor="let l of lines; let i = index">
        <div class="line-head">
          <strong>{{ 'form.line' | translate }} {{ i + 1 }}</strong>
          <span class="num">{{ l.amount | money:currency }}</span>
          <ion-button fill="clear" size="small" color="danger" (click)="lines.splice(i, 1)" [disabled]="lines.length === 1"><ion-icon name="trash-outline"></ion-icon></ion-button>
        </div>
        <ion-list lines="full" class="inner">
          <ion-item>
            <ion-select [label]="'form.item' | translate" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="l.item" (ionChange)="onItem(l)">
              <ion-select-option *ngFor="let c of catalog" [value]="c.name">{{ c.name }}</ion-select-option>
            </ion-select>
          </ion-item>
          <div class="qty-row">
            <ion-item><ion-input type="number" [label]="'form.qty' | translate" labelPlacement="stacked" [(ngModel)]="l.qty" (ionInput)="recalc(l)"></ion-input></ion-item>
            <ion-item><ion-input type="number" [label]="'form.unitPrice' | translate" labelPlacement="stacked" [(ngModel)]="l.unitPrice" (ionInput)="recalc(l)"></ion-input></ion-item>
          </div>
        </ion-list>
      </div>
      <ion-button expand="block" fill="outline" (click)="addLine()"><ion-icon name="add-circle-outline" slot="start"></ion-icon>{{ 'form.addItem' | translate }}</ion-button>

      <ion-list class="boxed notes" lines="none">
        <ion-item *ngIf="dt.hasDiscount">
          <ion-input type="number" [label]="'form.discount' | translate" labelPlacement="stacked" [(ngModel)]="discountPct" [helperText]="'form.discountHint' | translate"></ion-input>
        </ion-item>
        <ion-item><ion-textarea [label]="'form.notes' | translate" labelPlacement="stacked" [autoGrow]="true" [(ngModel)]="notes"></ion-textarea></ion-item>
      </ion-list>

      <div class="totals">
        <div><span>{{ 'form.subtotal' | translate }}</span><span>{{ subtotal | money:currency }}</span></div>
        <div *ngIf="discountAmount"><span>{{ 'form.discount' | translate }}</span><span>− {{ discountAmount | money:currency }}</span></div>
        <div *ngIf="dt.hasVat"><span>{{ 'form.vat' | translate }} ({{ vatRate }}%)</span><span>{{ vatAmount | money:currency }}</span></div>
      </div>
      <p class="err" *ngIf="error">{{ error }}</p>
    </ion-content>

    <ion-footer *ngIf="dt()">
      <ion-toolbar>
        <div class="foot">
          <div><small class="dim">{{ 'form.total' | translate }}</small><strong>{{ total | money:currency }}</strong></div>
          <ion-button (click)="submit()" [disabled]="saving || !definition()"><ion-icon name="send-outline" slot="start"></ion-icon>{{ (saving ? 'form.saving' : 'form.submit') | translate }}</ion-button>
        </div>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [`
    .head { margin-bottom: 4px; }
    .num-tag { color: var(--primary); background: var(--primary-soft); padding: 3px 8px; border-radius: 6px; display: inline-block; font-weight: 600; }
    .head p { font-size: 12.5px; margin: 8px 2px 0; }
    .warn { display: flex; gap: 8px; align-items: center; background: var(--warn-soft); color: var(--warn); padding: 10px 12px; border-radius: 12px; font-size: 12.5px; margin-top: 10px; }
    .line { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); margin-bottom: 10px; overflow: hidden; }
    .line-head { display: flex; align-items: center; gap: 8px; padding: 4px 4px 0 14px; }
    .line-head strong { flex: 1; font-size: 13px; }
    .line-head .num { font-weight: 700; font-size: 13.5px; }
    .inner { padding: 0; }
    .qty-row { display: grid; grid-template-columns: 1fr 1fr; }
    .notes { margin-top: 14px; }
    .totals { display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; padding: 4px 4px 0; }
    .totals div { display: flex; justify-content: space-between; }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 12px; }
    .foot div { display: flex; flex-direction: column; }
    .foot strong { font-size: 18px; }
    .err { color: var(--bad); font-size: 13px; }
  `]
})
export class DocFormPage implements OnInit {
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
  party = '';
  currency = 'SAR';
  notes = '';
  discountPct = 0;
  lines: DocLine[] = [];
  saving = false;
  error = '';

  constructor(private route: ActivatedRoute, private router: Router, public data: ErpDataService, private ctx: ErpContextService,
              private auth: AuthService, public i18n: I18nService, private api: PortalApiService, private toast: ToastController, private org: OrgService) {
    addIcons({ addCircleOutline, trashOutline, sendOutline, alertCircleOutline });
  }

  ngOnInit() {
    const dt = this.data.docTypeByKey(this.route.snapshot.paramMap.get('docType'));
    if (!dt) { this.router.navigate(['/tabs/new']); return; }
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
  onItem(l: DocLine) {
    const c = ITEM_CATALOG.find(x => x.name === l.item);
    if (c) { l.unit = c.unit; l.unitPrice = c.price; l.description = c.sku; this.recalc(l); }
  }
  recalc(l: DocLine) { l.amount = Math.round((+l.qty || 0) * (+l.unitPrice || 0) * 100) / 100; }

  get subtotal() { return this.lines.reduce((s, l) => s + (l.amount || 0), 0); }
  get discountAmount() { return this.dt()?.hasDiscount ? Math.round(this.subtotal * (+this.discountPct || 0)) / 100 : 0; }
  get vatAmount() { return this.dt()?.hasVat ? Math.round((this.subtotal - this.discountAmount) * this.vatRate) / 100 : 0; }
  get total() { return Math.round((this.subtotal - this.discountAmount + this.vatAmount) * 100) / 100; }

  submit() {
    const dt = this.dt();
    const def = this.definition();
    if (!dt || !def) return;
    this.lines.forEach(l => this.recalc(l));
    const valid = this.lines.filter(l => l.item && +l.qty > 0 && l.amount > 0);
    const needsParty = dt.partyKind !== 'warehouse';
    if ((needsParty && !this.party.trim()) || !valid.length || (dt.needsToWarehouse && this.toWarehouse === this.warehouse)) {
      this.error = this.i18n.t('form.invalid');
      return;
    }
    this.error = '';
    this.saving = true;
    const user = this.auth.currentUser();
    const initialData: Record<string, any> = {
      docType: dt.key, docNumber: this.number, module: dt.module,
      company: this.company, branch: this.branch, warehouse: this.warehouse,
      toWarehouse: dt.needsToWarehouse ? this.toWarehouse : undefined,
      docDate: this.docDate,
      party: needsParty ? this.party.trim() : `${this.warehouse} → ${this.toWarehouse}`,
      currency: this.currency, notes: this.notes || undefined,
      lines: valid.map(l => ({ item: l.item, description: l.description, qty: +l.qty, unit: l.unit, unitPrice: +l.unitPrice, amount: l.amount })),
      subtotal: this.subtotal, discountPct: dt.hasDiscount ? (+this.discountPct || 0) : 0, discountAmount: this.discountAmount,
      vatPct: dt.hasVat ? this.vatRate : 0, vatAmount: this.vatAmount, total: this.total,
      requesterName: user?.displayName,
      employeeName: dt.partyKind === 'employee' ? this.party : undefined,
      vendor: dt.partyKind === 'vendor' ? this.party : undefined,
    };
    Object.keys(initialData).forEach(k => initialData[k] === undefined && delete initialData[k]);

    this.api.startInstance(def.id, initialData).subscribe({
      next: async inst => {
        this.saving = false;
        this.data.refresh().subscribe();
        (await this.toast.create({ message: `${this.number} ✓`, duration: 1600, color: 'success', position: 'top' })).present();
        this.router.navigate(['/documents', inst.id], { replaceUrl: true });
      },
      error: err => { this.saving = false; this.error = typeof err?.error === 'string' ? err.error : (err?.message ?? 'Error'); }
    });
  }
}
