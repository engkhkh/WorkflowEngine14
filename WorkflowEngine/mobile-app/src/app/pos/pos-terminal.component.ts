import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { PosService } from '../core/pos.service';
import { CartLine, PosRec } from '../core/pos.models';
import { priceCart, r2 } from '../core/pos.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { PosReceiptComponent, printReceipt } from './pos-receipt.component';

interface Held { id: string; at: number; cart: CartLine[]; customer?: string; }

/** The till: scan / search, basket, customer + loyalty, promotions, payments, receipt, hold, offline queue. Needs pos.sell. */
@Component({
  selector: 'app-pos-terminal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, NumPipe, IconComponent, PosReceiptComponent],
  template: `
    <p class="flash bad" *ngIf="error && !payOpen()">{{ error }}</p>
    <p class="flash" *ngIf="pos.queue().length"><app-icon name="alert" [size]="14"></app-icon> {{ 'pos.queued' | translate: { n: pos.queue().length } }} <button class="ghost sm" (click)="pos.flush()">{{ 'pos.syncNow' | translate }}</button></p>
    <p class="flash bad" *ngIf="pos.rejected().length">{{ 'pos.rejectedN' | translate: { n: pos.rejected().length } }} <button class="ghost sm" (click)="pos.clearRejected()">{{ 'pos.dismiss' | translate }}</button></p>

    <!-- no open shift -->
    <div class="card gate" *ngIf="loaded() && !pos.shift() && pos.settings().requireShift">
      <h3>{{ 'pos.shift.none' | translate }}</h3>
      <p class="dim">{{ 'pos.shift.noneHint' | translate }}</p>
      <div class="form-grid">
        <div *ngIf="pos.registers().length"><label class="lbl">{{ 'pos.register' | translate }}</label>
          <select [(ngModel)]="openReg"><option value="">—</option><option *ngFor="let r of pos.registers()" [value]="r.code">{{ r.code }} · {{ r.data['name'] }}</option></select></div>
        <div><label class="lbl">{{ 'pos.shift.opening' | translate }}</label><input type="number" step="0.01" [(ngModel)]="openCash" /></div>
      </div>
      <button class="primary" (click)="openShift()" [disabled]="busy">{{ 'pos.shift.open' | translate }}</button>
    </div>

    <div class="till" *ngIf="loaded() && (pos.shift() || !pos.settings().requireShift)">
      <section class="left">
        <div class="bar">
          <div class="scan"><app-icon name="search" [size]="16"></app-icon>
            <input #sc [placeholder]="'pos.scan' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" (keyup.enter)="scan(sc)" autofocus /></div>
          <select class="brsel" *ngIf="pos.hasBranches()" [ngModel]="pos.branch()" (ngModelChange)="ctx.branch.set($event)" [disabled]="!!pos.shift()" [title]="'pos.branch' | translate">
            <option *ngFor="let b of ctx.branches()" [value]="b.code">{{ b.code }} · {{ i18n.nm(b) }}</option></select>
          <span class="chip" *ngIf="pos.shift() as sh">{{ sh.code }}</span>
          <a class="ghost sm" routerLink="/pos/shifts">{{ 'pos.nav.shifts' | translate }}</a>
        </div>
        <div class="cats">
          <button [class.on]="!cat()" (click)="cat.set('')">{{ 'pos.all' | translate }}</button>
          <button *ngFor="let c of categoryNames()" [class.on]="cat() === c" (click)="cat.set(c)">{{ catName(c) }}</button>
        </div>
        <div class="grid">
          <button class="tile" *ngFor="let p of shown()" (click)="add(p.code!)" [disabled]="soldOut(p)">
            <b>{{ p.data['name'] }}</b>
            <span class="pr">{{ p.data['price'] | num: 2 }}</span>
            <small class="dim">{{ p.code }}<ng-container *ngIf="stockOf(p) !== null"> · {{ 'pos.left' | translate: { n: stockOf(p)! } }}</ng-container></small>
            <i class="promo" *ngIf="hasPromo(p)">%</i>
          </button>
          <div class="empty" *ngIf="!shown().length">{{ 'pos.noProducts' | translate }}</div>
        </div>
      </section>

      <aside class="cart card">
        <div class="cust">
          <select [ngModel]="customerCode()" (ngModelChange)="setCustomer($event)">
            <option value="">{{ 'pos.walkin' | translate }}</option>
            <option *ngFor="let c of pos.customers()" [value]="c.code">{{ c.data['name'] }} · {{ c.code }}</option>
          </select>
          <small class="dim" *ngIf="customer() as c">{{ 'pos.points' | translate }}: <b>{{ c.data['points'] || 0 }}</b><span *ngIf="c.data['discountPct']"> · {{ c.data['discountPct'] }}%</span></small>
        </div>
        <div class="lines">
          <div class="ln" *ngFor="let l of priced().lines; let i = index">
            <div class="top"><span class="nm">{{ l.name }}</span><b>{{ l.total | num: 2 }}</b></div>
            <div class="sub">
              <button class="ghost sm" (click)="qty(i, -1)">−</button>
              <input class="q" type="number" min="1" [ngModel]="l.qty" (ngModelChange)="setQty(i, $event)" />
              <button class="ghost sm" (click)="qty(i, 1)">+</button>
              <span class="dim">× {{ l.price | num: 2 }}</span>
              <span class="tag" *ngIf="l.promo">{{ l.promoCode }} −{{ l.promo | num: 2 }}</span>
              <input class="d" type="number" min="0" [max]="pos.settings().maxDiscountPct" *ngIf="auth.can('pos.discount')" [ngModel]="l.discountPct" (ngModelChange)="setLineDisc(i, $event)" [title]="'pos.lineDisc' | translate" placeholder="%" /><small class="dim" *ngIf="auth.can('pos.discount')">%</small>
              <button class="ghost sm danger-i" (click)="remove(i)"><app-icon name="x" [size]="14"></app-icon></button>
            </div>
          </div>
          <div class="empty" *ngIf="!cart().length">{{ 'pos.emptyCart' | translate }}</div>
        </div>
        <div class="tot">
          <div class="r"><span>{{ 'pos.subtotal' | translate }}</span><span>{{ priced().subtotal | num: 2 }}</span></div>
          <div class="r" *ngIf="priced().discount"><span>{{ 'pos.discount' | translate }}</span><span>−{{ priced().discount | num: 2 }}</span></div>
          <div class="r" *ngIf="auth.can('pos.discount')"><span>{{ 'pos.orderDisc' | translate }}</span><input class="d" type="number" min="0" [max]="pos.settings().maxDiscountPct" [ngModel]="orderPct()" (ngModelChange)="orderPct.set(+$event || 0)" placeholder="%" /></div>
          <div class="r"><span>{{ 'pos.tax' | translate }}</span><span>{{ priced().tax | num: 2 }}</span></div>
          <div class="r grand"><span>{{ 'pos.total' | translate }}</span><span>{{ priced().total | num: 2 }} {{ ctx.companyObj().currency }}</span></div>
        </div>
        <div class="btns">
          <button (click)="hold()" [disabled]="!cart().length"><app-icon name="clock" [size]="14"></app-icon>{{ 'pos.hold' | translate }}</button>
          <button (click)="heldOpen.set(true)" *ngIf="held().length">{{ 'pos.recall' | translate }} ({{ held().length }})</button>
          <button (click)="clear()" [disabled]="!cart().length">{{ 'pos.clear' | translate }}</button>
          <button class="primary pay" (click)="openPay()" [disabled]="!cart().length">{{ 'pos.pay' | translate }}</button>
        </div>
      </aside>
    </div>

    <!-- payment -->
    <div class="modal-scrim" *ngIf="payOpen()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.pay' | translate }} · {{ priced().total | num: 2 }} {{ ctx.companyObj().currency }}</h3></div>
        <div class="modal-body">
          <div class="form-grid">
            <div><label class="lbl">{{ 'pos.pay.cash' | translate }}</label><input type="number" step="0.01" [ngModel]="cash()" (ngModelChange)="cash.set(+$event || 0)" /></div>
            <div><label class="lbl">{{ 'pos.pay.card' | translate }}</label><input type="number" step="0.01" [ngModel]="card()" (ngModelChange)="card.set(+$event || 0)" /></div>
            <div><label class="lbl">{{ 'pos.pay.other' | translate }}</label><input type="number" step="0.01" [ngModel]="other()" (ngModelChange)="other.set(+$event || 0)" /></div>
            <div *ngIf="customer() && (customer()!.data['points'] || 0) > 0"><label class="lbl">{{ 'pos.redeem' | translate }} ({{ customer()!.data['points'] }})</label>
              <input type="number" min="0" [max]="customer()!.data['points']" [ngModel]="redeem()" (ngModelChange)="redeem.set(+$event || 0)" />
              <small class="dim">= {{ redeemValue() | num: 2 }}</small></div>
          </div>
          <div class="quick">
            <button (click)="exact('cash')">{{ 'pos.exactCash' | translate }}</button>
            <button (click)="exact('card')">{{ 'pos.exactCard' | translate }}</button>
            <button *ngFor="let n of [50, 100, 200, 500]" (click)="cash.set(n)">{{ n }}</button>
          </div>
          <div class="sum">
            <div class="r"><span>{{ 'pos.due' | translate }}</span><b>{{ due() | num: 2 }}</b></div>
            <div class="r"><span>{{ 'pos.tendered' | translate }}</span><b>{{ tendered() | num: 2 }}</b></div>
            <div class="r" [class.bad]="remaining() > 0"><span>{{ remaining() > 0 ? ('pos.remaining' | translate) : ('pos.change' | translate) }}</span><b>{{ (remaining() > 0 ? remaining() : -remaining()) | num: 2 }}</b></div>
          </div>
          <p class="flash bad" *ngIf="error">{{ error }}</p>
        </div>
        <div class="modal-foot"><button (click)="payOpen.set(false)">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="checkout()" [disabled]="busy || remaining() > 0.004">{{ 'pos.complete' | translate }}</button></div>
      </div>
    </div>

    <!-- receipt -->
    <div class="modal-scrim" *ngIf="receipt()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.saleDone' | translate }}</h3></div>
        <div class="modal-body"><app-pos-receipt [sale]="receipt()"></app-pos-receipt></div>
        <div class="modal-foot"><button (click)="print()"><app-icon name="printer" [size]="14"></app-icon>{{ 'pos.print' | translate }}</button><button class="primary" (click)="receipt.set(null)">{{ 'pos.newSale' | translate }}</button></div>
      </div>
    </div>

    <!-- held baskets -->
    <div class="modal-scrim" *ngIf="heldOpen()" (click)="heldOpen.set(false)">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.recall' | translate }}</h3></div>
        <div class="modal-body"><div class="heldrow" *ngFor="let h of held()"><span>{{ h.at | date: 'shortTime' }} · {{ h.cart.length }} {{ 'pos.items' | translate }}</span>
          <span><button class="ghost sm" (click)="recall(h)">{{ 'pos.recallOne' | translate }}</button><button class="ghost sm danger-i" (click)="dropHeld(h)"><app-icon name="trash" [size]="14"></app-icon></button></span></div></div>
        <div class="modal-foot"><button (click)="heldOpen.set(false)">{{ 'common.cancel' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .gate { max-width: 520px; padding: 20px; display: grid; gap: 12px; } .gate h3 { margin: 0; }
    .till { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
    @media (max-width: 1000px) { .till { grid-template-columns: 1fr; } }
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
    .scan { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: var(--radius); padding: 0 10px; background: var(--surface); }
    .scan input { border: 0; outline: 0; background: transparent; flex: 1; padding: 10px 0; }
    .brsel { width: auto; max-width: 180px; }
    .cats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; } .cats button { padding: 5px 12px; border-radius: 999px; } .cats button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .tile { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; text-align: start; min-height: 92px; white-space: normal; }
    .tile b { font-size: 13px; } .tile .pr { font-weight: 700; color: var(--primary); } .tile:disabled { opacity: .45; }
    .promo { position: absolute; top: 6px; inset-inline-end: 6px; background: #f59e0b; color: #fff; border-radius: 50%; width: 18px; height: 18px; display: grid; place-items: center; font-size: 11px; font-style: normal; font-weight: 700; }
    .cart { padding: 12px; display: flex; flex-direction: column; gap: 10px; position: sticky; top: 8px; }
    .cust { display: grid; gap: 4px; } .lines { max-height: 46vh; overflow-y: auto; display: grid; gap: 8px; }
    .ln { border-bottom: 1px solid var(--border); padding-bottom: 8px; } .top { display: flex; justify-content: space-between; gap: 8px; } .nm { font-weight: 550; }
    .sub { display: flex; gap: 6px; align-items: center; margin-top: 4px; flex-wrap: wrap; } .q { width: 54px; text-align: center; padding: 4px; } .d { width: 56px; padding: 4px; }
    .tag { background: #fef3c7; color: #92400e; border-radius: 4px; padding: 1px 6px; font-size: 11px; } .danger-i { color: var(--bad); }
    .tot { display: grid; gap: 4px; } .r { display: flex; justify-content: space-between; align-items: center; gap: 8px; } .grand { font-size: 18px; font-weight: 700; padding-top: 6px; border-top: 1px solid var(--border); }
    .btns { display: flex; gap: 8px; flex-wrap: wrap; } .btns .pay { flex: 1; min-width: 120px; padding: 12px; font-size: 15px; }
    .quick { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; } .sum { display: grid; gap: 6px; } .sum .bad b { color: var(--bad); }
    .heldrow { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
  `]
})
export class PosTerminalComponent implements OnInit {
  auth = inject(AuthService); ctx = inject(ErpContextService); pos = inject(PosService); i18n = inject(I18nService);

  loaded = signal(false);
  q = signal(''); cat = signal('');
  cart = signal<CartLine[]>([]);
  customerCode = signal('');
  orderPct = signal(0);
  stock = signal<Record<string, number> | null>(null);
  payOpen = signal(false); receipt = signal<PosRec | null>(null);
  cash = signal(0); card = signal(0); other = signal(0); redeem = signal(0);
  held = signal<Held[]>([]); heldOpen = signal(false);
  openReg = ''; openCash = 0; busy = false; error = '';
  private localId = '';

  branchName = () => { const b = this.ctx.branches().find(x => x.code === this.pos.branch()); return b ? this.i18n.nm(b) : ''; };
  customer = computed(() => this.pos.customers().find(c => c.code === this.customerCode()));
  priced = computed(() => priceCart(this.cart(), this.pos.products(), this.pos.promotions(), this.customer(), this.orderPct(), this.pos.settings(), this.pos.branch()));
  categoryNames = computed(() => [...new Set(this.pos.products().map(p => String(p.data['category'] ?? '')).filter(Boolean))].sort());
  shown = computed(() => {
    const q = this.q().toLowerCase().trim(), c = this.cat();
    return this.pos.products().filter(p => p.status !== 'Inactive' && (!c || p.data['category'] === c)
      && (!q || (p.data['name'] ?? '').toLowerCase().includes(q) || (p.code ?? '').toLowerCase().includes(q) || String(p.data['barcode'] ?? '').toLowerCase().includes(q))).slice(0, 80);
  });
  redeemValue = computed(() => r2(Math.min(this.redeem(), Number(this.customer()?.data['points']) || 0) * this.pos.settings().pointValue));
  due = computed(() => r2(Math.max(0, this.priced().total - Math.min(this.redeemValue(), this.priced().total))));
  tendered = computed(() => r2(this.cash() + this.card() + this.other()));
  remaining = computed(() => r2(this.due() - this.tendered()));

  constructor() {
    effect(() => {            // changing company / branch reloads the catalogue, stock and the open shift
      const c = this.ctx.company(), b = this.pos.branch();
      this.loaded.set(false);
      this.pos.loadCatalog(c, b).subscribe(() => {
        this.pos.currentShift().pipe(catchError(() => of(null))).subscribe(() => this.loaded.set(true));
        this.pos.records('stock', { company: c, branch: b }).pipe(catchError(() => of(null))).subscribe(l => {
          if (!l) { this.stock.set(null); return; }
          const m: Record<string, number> = {};
          for (const s of l) m[String(s.data['sku'])] = Number(s.data['qty']) || 0;
          this.stock.set(m);
        });
      });
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    try { this.held.set(JSON.parse(localStorage.getItem(this.heldKey()) ?? '[]')); } catch { /* ignore */ }
    this.pos.flush();
  }
  private heldKey() { return 'portal_pos_held:' + (this.auth.currentUser()?.username ?? ''); }
  private saveHeld(h: Held[]) { this.held.set(h); try { localStorage.setItem(this.heldKey(), JSON.stringify(h)); } catch { /* ignore */ } }

  catName(code: string) { const c = this.pos.categories().find(x => x.code === code); return c ? (this.i18n.lang() === 'ar' && c.data['nameAr'] ? c.data['nameAr'] : c.data['name'] ?? code) : code; }
  stockOf(p: PosRec): number | null { const m = this.stock(); return m && p.data['trackStock'] ? (m[p.code!] ?? 0) : null; }
  soldOut(p: PosRec) { const s = this.stockOf(p); return s !== null && s <= 0 && !this.pos.settings().allowNegativeStock; }
  hasPromo(p: PosRec) { return this.pos.promotions().some(x => x.status === 'Active' && (x.data['scope'] === 'all' || String(x.data['target']).toLowerCase() === (p.code ?? '').toLowerCase() || String(x.data['target']).toLowerCase() === String(p.data['category'] ?? '').toLowerCase())); }

  scan(el: HTMLInputElement) {
    const t = this.q().trim().toLowerCase();
    if (!t) return;
    const exact = this.pos.products().find(p => (p.code ?? '').toLowerCase() === t || String(p.data['barcode'] ?? '').toLowerCase() === t);
    const one = exact ?? (this.shown().length === 1 ? this.shown()[0] : undefined);
    if (one) { this.add(one.code!); this.q.set(''); } else this.error = this.i18n.t('pos.notFound');
    el.focus();
  }
  add(sku: string) {
    this.error = '';
    const c = [...this.cart()]; const i = c.findIndex(x => x.sku === sku);
    if (i >= 0) c[i] = { ...c[i], qty: c[i].qty + 1 }; else c.push({ sku, qty: 1, discountPct: 0 });
    this.cart.set(c);
  }
  qty(i: number, d: number) { this.setQty(i, this.cart()[i].qty + d); }
  setQty(i: number, v: number) { const c = [...this.cart()]; const n = Math.max(0, Number(v) || 0); if (n <= 0) c.splice(i, 1); else c[i] = { ...c[i], qty: n }; this.cart.set(c); }
  setLineDisc(i: number, v: number) { const c = [...this.cart()]; c[i] = { ...c[i], discountPct: Math.min(this.pos.settings().maxDiscountPct, Math.max(0, Number(v) || 0)) }; this.cart.set(c); }
  remove(i: number) { const c = [...this.cart()]; c.splice(i, 1); this.cart.set(c); }
  clear() { this.cart.set([]); this.orderPct.set(0); this.customerCode.set(''); }
  setCustomer(code: string) { this.customerCode.set(code); this.redeem.set(0); }

  hold() { this.saveHeld([...this.held(), { id: crypto.randomUUID?.() ?? String(Date.now()), at: Date.now(), cart: this.cart(), customer: this.customerCode() }]); this.clear(); }
  recall(h: Held) { this.cart.set(h.cart); this.customerCode.set(h.customer ?? ''); this.saveHeld(this.held().filter(x => x.id !== h.id)); this.heldOpen.set(false); }
  dropHeld(h: Held) { this.saveHeld(this.held().filter(x => x.id !== h.id)); }

  openShift() {
    this.busy = true; this.error = '';
    this.pos.openShift({ company: this.ctx.company(), branch: this.pos.branch(), register: this.openReg || undefined, openingCash: Number(this.openCash) || 0 })
      .subscribe({ next: () => this.busy = false, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } });
  }

  openPay() { this.error = ''; this.cash.set(0); this.card.set(0); this.other.set(0); this.redeem.set(0); this.localId = crypto.randomUUID?.() ?? String(Date.now()); this.payOpen.set(true); }
  exact(m: 'cash' | 'card') { this.cash.set(0); this.card.set(0); this.other.set(0); (m === 'cash' ? this.cash : this.card).set(this.due()); }

  checkout() {
    this.busy = true; this.error = '';
    const payments = [
      ...(this.cash() > 0 ? [{ method: 'cash' as const, amount: this.cash() }] : []),
      ...(this.card() > 0 ? [{ method: 'card' as const, amount: this.card() }] : []),
      ...(this.other() > 0 ? [{ method: 'other' as const, amount: this.other() }] : []),
    ];
    const body = {
      company: this.ctx.company(), branch: this.pos.branch(), register: this.pos.shift()?.ref ?? undefined, customer: this.customerCode() || undefined,
      lines: this.cart(), payments, discountPct: this.orderPct(), redeemPoints: this.redeem(), localId: this.localId
    };
    this.pos.checkout(body).subscribe({
      next: s => { this.busy = false; this.done(s); },
      error: e => {
        this.busy = false;
        if (e?.status === 0) {          // the network is down: keep the sale, show a provisional receipt, send it later
          this.pos.enqueue(body);
          const p = this.priced();
          this.done({ id: '', kind: 'sale', code: this.i18n.t('pos.offlineCode'), status: 'Queued', createdAt: new Date().toISOString(), company: body.company, branch: body.branch,
            data: { type: 'Sale', lines: p.lines.map(l => ({ ...l, discount: l.discount })), subtotal: p.subtotal, discount: p.discount, tax: p.tax, total: p.total,
              payments, change: Math.max(0, -this.remaining()), cashier: this.auth.currentUser()?.username } });
        } else this.error = errMsg(e, this.i18n);
      }
    });
  }
  private done(s: PosRec) {
    this.payOpen.set(false); this.receipt.set(s); this.clear();
    this.pos.records('stock', { company: this.ctx.company(), branch: this.pos.branch() }).pipe(catchError(() => of(null))).subscribe(l => {
      if (!l) return; const m: Record<string, number> = {}; for (const x of l) m[String(x.data['sku'])] = Number(x.data['qty']) || 0; this.stock.set(m);
    });
    this.pos.records('customer', { company: this.ctx.company(), take: 5000 }).pipe(catchError(() => of(null))).subscribe(l => { if (l) this.pos.customers.set(l); });
    this.pos.currentShift().pipe(catchError(() => of(null))).subscribe();
  }
  print() { printReceipt(); }
}
