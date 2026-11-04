import { defaultCurrency } from '../core/region';
import { Component, HostListener, NgZone, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ErpContextService } from '../core/erp-context.service';
import { PosService } from '../core/pos.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { WebsiteService } from './website.service';
import { renderSite } from './site-renderer';
import { BLOCK_DEFS, Block, BlockDef, DEFAULT_THEME, FieldDef, Page, ShopItem, SiteDesign, SiteRow, blockDef, newBlock, uid } from './website.models';

const AR_LABELS: Record<string, string> = { add: 'أضف إلى السلة', cart: 'سلتك', total: 'الإجمالي', name: 'الاسم', email: 'البريد الإلكتروني', phone: 'الهاتف', message: 'الرسالة', address: 'عنوان التوصيل', note: 'ملاحظة', order: 'إرسال الطلب',
  empty: 'السلة فارغة', thanks: 'شكراً لك! رقم طلبك', sent: 'تم إرسال الرسالة. شكراً لك!', fail: 'تعذر الإرسال. حاول مرة أخرى.', noProducts: 'لا توجد منتجات بعد.', nopub: 'الطلب يعمل بعد نشر الموقع.' };

type Panel = 'add' | 'layers' | 'pages' | 'theme' | 'shop';
type Device = 'desktop' | 'tablet' | 'mobile';

/** Visual site designer: palette of blocks, live canvas (an iframe showing the real rendered site), properties panel, pages, theme, shop. */
@Component({
  selector: 'app-website-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
  <ng-template #fld let-f let-obj="obj">
    <div class="fld" [ngSwitch]="f.kind">
      <label class="lbl">{{ f.label | translate }}</label>
      <input *ngSwitchCase="'text'" [ngModel]="obj[f.key]" (ngModelChange)="set(obj, f.key, $event)" [readOnly]="!canEdit" />
      <textarea *ngSwitchCase="'textarea'" rows="3" [ngModel]="obj[f.key]" (ngModelChange)="set(obj, f.key, $event)" [readOnly]="!canEdit"></textarea>
      <input *ngSwitchCase="'number'" type="number" [attr.min]="f.min" [attr.max]="f.max" [ngModel]="obj[f.key]" (ngModelChange)="set(obj, f.key, $event)" [readOnly]="!canEdit" />
      <select *ngSwitchCase="'select'" [ngModel]="obj[f.key]" (ngModelChange)="set(obj, f.key, $event)" [disabled]="!canEdit">
        <option *ngFor="let o of f.options" [value]="o.v">{{ o.l | translate }}</option></select>
      <div *ngSwitchCase="'image'" class="imgf">
        <div class="thumb" [style.background-image]="obj[f.key] ? 'url(' + obj[f.key] + ')' : ''"></div>
        <input [ngModel]="isData(obj[f.key]) ? '' : obj[f.key]" (ngModelChange)="set(obj, f.key, $event)" placeholder="https://…" [readOnly]="!canEdit" />
        <label class="up sm" *ngIf="canEdit"><app-icon name="upload" [size]="14"></app-icon>{{ 'web.upload' | translate }}<input type="file" accept="image/*" hidden (change)="upload(obj, f.key, $event)" /></label>
        <button class="ghost sm" *ngIf="obj[f.key] && canEdit" (click)="set(obj, f.key, '')"><app-icon name="x" [size]="14"></app-icon></button>
      </div>
      <div *ngSwitchCase="'list'" class="list">
        <div class="li" *ngFor="let it of obj[f.key]; let i = index">
          <div class="lih"><b>#{{ i + 1 }}</b><span class="sp"></span>
            <button class="ghost sm" (click)="moveItem(obj[f.key], i, -1)" [disabled]="i === 0"><app-icon name="up" [size]="13"></app-icon></button>
            <button class="ghost sm" (click)="moveItem(obj[f.key], i, 1)" [disabled]="i === obj[f.key].length - 1"><app-icon name="down" [size]="13"></app-icon></button>
            <button class="ghost sm danger-i" (click)="delItem(obj[f.key], i)"><app-icon name="trash" [size]="13"></app-icon></button></div>
          <ng-container *ngFor="let sf of f.itemFields"><ng-container *ngTemplateOutlet="fld; context: { $implicit: sf, obj: it }"></ng-container></ng-container>
        </div>
        <button class="sm" *ngIf="canEdit" (click)="addItem(obj[f.key], f.itemDefault)"><app-icon name="plus" [size]="13"></app-icon>{{ 'web.addItem' | translate }}</button>
      </div>
    </div>
  </ng-template>

  <div class="ds" *ngIf="d() as dd; else loading">
    <header class="bar">
      <button class="ghost sm" (click)="back()"><app-icon name="chevron" [size]="15" style="transform:rotate(180deg)"></app-icon>{{ 'web.sites' | translate }}</button>
      <input class="nm" [(ngModel)]="name" (ngModelChange)="dirty = true; queueSave()" [readOnly]="!canEdit" />
      <span class="sp"></span>
      <div class="seg"><button [class.on]="device() === 'desktop'" (click)="device.set('desktop')"><app-icon name="monitor" [size]="15"></app-icon></button>
        <button [class.on]="device() === 'tablet'" (click)="device.set('tablet')"><app-icon name="tablet" [size]="15"></app-icon></button>
        <button [class.on]="device() === 'mobile'" (click)="device.set('mobile')"><app-icon name="smartphone" [size]="15"></app-icon></button></div>
      <button class="ghost sm" (click)="undo()" [disabled]="!undoStack.length" [title]="'web.undo' | translate"><app-icon name="undo" [size]="15"></app-icon></button>
      <button class="ghost sm" (click)="redo()" [disabled]="!redoStack.length" [title]="'web.redo' | translate"><app-icon name="redo" [size]="15"></app-icon></button>
      <span class="state dim">{{ (saving ? 'web.saving' : dirty ? 'web.unsaved' : 'web.saved') | translate }}</span>
      <button class="sm" (click)="previewTab()"><app-icon name="eye" [size]="14"></app-icon>{{ 'web.preview' | translate }}</button>
      <button class="sm" (click)="download()"><app-icon name="download" [size]="14"></app-icon>{{ 'web.download' | translate }}</button>
      <button class="primary sm" *ngIf="auth.can('web.publish')" (click)="openPublish()"><app-icon name="globe" [size]="14"></app-icon>{{ (row()?.published ? 'web.published' : 'web.publish') | translate }}</button>
    </header>

    <div class="body">
      <aside class="left">
        <div class="ptabs">
          <button *ngFor="let p of panels" [class.on]="panel() === p.k" (click)="panel.set(p.k)" [title]="p.l | translate"><app-icon [name]="p.i" [size]="16"></app-icon><small>{{ p.l | translate }}</small></button>
        </div>
        <div class="pbody">
          <ng-container *ngIf="panel() === 'add'">
            <p class="dim hint">{{ 'web.addHint' | translate }}</p>
            <div class="pal"><button *ngFor="let b of defs" draggable="true" (dragstart)="dragType = b.type; dragFrom = -1" (click)="addBlock(b.type)" [disabled]="!canEdit"><app-icon [name]="b.icon" [size]="18"></app-icon><span>{{ b.label | translate }}</span></button></div>
          </ng-container>

          <ng-container *ngIf="panel() === 'layers'">
            <div class="layers" (dragover)="$event.preventDefault()" (drop)="dropAt(page()!.blocks.length)">
              <div class="ly" *ngFor="let b of page()?.blocks; let i = index" [class.on]="sel() === b.id" draggable="true"
                   (dragstart)="dragFrom = i; dragType = ''" (dragover)="$event.preventDefault()" (drop)="dropAt(i); $event.stopPropagation()" (click)="select(b.id)">
                <app-icon [name]="icon(b.type)" [size]="14"></app-icon><span class="t">{{ label(b.type) | translate }}</span>
                <span class="sp"></span>
                <button class="ghost xs" (click)="move(i, -1); $event.stopPropagation()" [disabled]="i === 0 || !canEdit"><app-icon name="up" [size]="12"></app-icon></button>
                <button class="ghost xs" (click)="move(i, 1); $event.stopPropagation()" [disabled]="i === page()!.blocks.length - 1 || !canEdit"><app-icon name="down" [size]="12"></app-icon></button>
                <button class="ghost xs" (click)="dup(i); $event.stopPropagation()" [disabled]="!canEdit"><app-icon name="copy" [size]="12"></app-icon></button>
                <button class="ghost xs danger-i" (click)="del(i); $event.stopPropagation()" [disabled]="!canEdit"><app-icon name="trash" [size]="12"></app-icon></button>
              </div>
            </div>
            <p class="dim hint">{{ 'web.layersHint' | translate }}</p>
          </ng-container>

          <ng-container *ngIf="panel() === 'pages'">
            <div class="pg" *ngFor="let p of dd.pages; let i = index" [class.on]="p.id === pageId()">
              <button class="pgn" (click)="pageId.set(p.id); sel.set('')">{{ p.title }} <small class="mono dim">{{ p.path }}</small></button>
              <button class="ghost xs" (click)="movePage(i, -1)" [disabled]="i === 0 || !canEdit"><app-icon name="up" [size]="12"></app-icon></button>
              <button class="ghost xs" (click)="movePage(i, 1)" [disabled]="i === dd.pages.length - 1 || !canEdit"><app-icon name="down" [size]="12"></app-icon></button>
              <button class="ghost xs danger-i" (click)="delPage(p)" [disabled]="dd.pages.length < 2 || !canEdit"><app-icon name="trash" [size]="12"></app-icon></button>
            </div>
            <ng-container *ngIf="page() as pg">
              <div class="fld"><label class="lbl">{{ 'web.pageTitle' | translate }}</label><input [ngModel]="pg.title" (ngModelChange)="set(pg, 'title', $event)" [readOnly]="!canEdit" /></div>
              <div class="fld"><label class="lbl">{{ 'web.pagePath' | translate }}</label><input [ngModel]="pg.path" (ngModelChange)="setPath(pg, $event)" [readOnly]="!canEdit" /></div>
            </ng-container>
            <div class="fld" *ngIf="canEdit"><input [(ngModel)]="newPageTitle" [placeholder]="'web.newPage' | translate" (keyup.enter)="addPage()" /><button class="sm" (click)="addPage()" [disabled]="!newPageTitle.trim()"><app-icon name="plus" [size]="13"></app-icon>{{ 'web.addPage' | translate }}</button></div>
            <p class="dim hint">{{ 'web.pagesHint' | translate }}</p>
          </ng-container>

          <ng-container *ngIf="panel() === 'theme'">
            <div class="fld"><label class="lbl">{{ 'web.siteTitle' | translate }}</label><input [ngModel]="dd.settings.title" (ngModelChange)="set(dd.settings, 'title', $event)" [readOnly]="!canEdit" /></div>
            <div class="fld"><label class="lbl">{{ 'web.metaDesc' | translate }}</label><textarea rows="2" [ngModel]="dd.settings.description" (ngModelChange)="set(dd.settings, 'description', $event)" [readOnly]="!canEdit"></textarea></div>
            <div class="fld"><label class="lbl">{{ 'web.language' | translate }}</label>
              <select [ngModel]="dd.settings.dir" (ngModelChange)="setLang($event)" [disabled]="!canEdit"><option value="ltr">English (LTR)</option><option value="rtl">العربية (RTL)</option></select></div>
            <div class="fld"><label class="lbl">{{ 'web.colorPrimary' | translate }}</label><input type="color" [ngModel]="dd.theme.primary" (ngModelChange)="set(dd.theme, 'primary', $event)" [disabled]="!canEdit" /></div>
            <div class="fld"><label class="lbl">{{ 'web.colorBg' | translate }}</label><input type="color" [ngModel]="dd.theme.bg" (ngModelChange)="set(dd.theme, 'bg', $event)" [disabled]="!canEdit" /></div>
            <div class="fld"><label class="lbl">{{ 'web.colorText' | translate }}</label><input type="color" [ngModel]="dd.theme.text" (ngModelChange)="set(dd.theme, 'text', $event)" [disabled]="!canEdit" /></div>
            <div class="fld"><label class="lbl">{{ 'web.font' | translate }}</label>
              <select [ngModel]="dd.theme.font" (ngModelChange)="set(dd.theme, 'font', $event)" [disabled]="!canEdit"><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option><option value="arabic">Arabic (Tahoma)</option></select></div>
            <div class="fld"><label class="lbl">{{ 'web.radius' | translate }} ({{ dd.theme.radius }}px)</label><input type="range" min="0" max="28" [ngModel]="dd.theme.radius" (ngModelChange)="set(dd.theme, 'radius', +$event)" [disabled]="!canEdit" /></div>
            <div class="fld chk"><label><input type="checkbox" [ngModel]="dd.theme.dark" (ngModelChange)="set(dd.theme, 'dark', $event)" [disabled]="!canEdit" /> {{ 'web.dark' | translate }}</label></div>
          </ng-container>

          <ng-container *ngIf="panel() === 'shop'">
            <div class="fld chk"><label><input type="checkbox" [ngModel]="dd.shop.enabled" (ngModelChange)="set(dd.shop, 'enabled', $event)" [disabled]="!canEdit" /> {{ 'web.shopOn' | translate }}</label></div>
            <p class="dim hint">{{ 'web.shopHint' | translate }}</p>
            <div class="fld"><label class="lbl">{{ 'web.currency' | translate }}</label><input [ngModel]="dd.shop.currency" (ngModelChange)="set(dd.shop, 'currency', $event)" [readOnly]="!canEdit" /></div>
            <button class="sm primary" (click)="syncProducts()" [disabled]="!canEdit || syncing"><app-icon name="store" [size]="14"></app-icon>{{ 'web.sync' | translate }}</button>
            <p class="flash bad" *ngIf="syncError">{{ syncError }}</p>
            <div class="prods"><div class="pr" *ngFor="let p of dd.shop.products">
              <div class="thumb s" [style.background-image]="p.image ? 'url(' + p.image + ')' : ''"></div>
              <div class="pi"><strong>{{ p.name }}</strong><small class="dim">{{ p.sku }} · {{ p.price }}</small>
                <input [ngModel]="isData(p.image) ? '' : (p.image || '')" (ngModelChange)="set(p, 'image', $event)" placeholder="https://… image" [readOnly]="!canEdit" /></div>
              <label class="up xs" *ngIf="canEdit"><app-icon name="upload" [size]="12"></app-icon><input type="file" accept="image/*" hidden (change)="upload(p, 'image', $event)" /></label>
            </div></div>
          </ng-container>
        </div>
      </aside>

      <section class="canvas" [class.t]="device() === 'tablet'" [class.m]="device() === 'mobile'">
        <div class="tabsbar"><button *ngFor="let p of dd.pages" [class.on]="p.id === pageId()" (click)="pageId.set(p.id); sel.set('')">{{ p.title }}</button></div>
        <div class="frame"><iframe sandbox="allow-scripts" [srcdoc]="srcdoc()" title="preview"></iframe></div>
      </section>

      <aside class="right">
        <ng-container *ngIf="block() as b; else none">
          <h4>{{ label(b.type) | translate }}</h4>
          <ng-container *ngFor="let f of fieldsOf(b)"><ng-container *ngTemplateOutlet="fld; context: { $implicit: f, obj: b.props }"></ng-container></ng-container>
          <div class="ract" *ngIf="canEdit"><button class="sm" (click)="dupSel()"><app-icon name="copy" [size]="13"></app-icon>{{ 'web.duplicate' | translate }}</button>
            <button class="sm danger-i" (click)="delSel()"><app-icon name="trash" [size]="13"></app-icon>{{ 'common.delete' | translate }}</button></div>
        </ng-container>
        <ng-template #none><div class="empty small">{{ 'web.selectHint' | translate }}</div></ng-template>
      </aside>
    </div>

    <div class="modal-scrim" *ngIf="pub" (click)="pub = false">
      <div class="modal" style="max-width:560px" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'web.publish' | translate }}</h3><button class="ghost icon-btn" (click)="pub = false"><app-icon name="x"></app-icon></button></div>
        <div class="modal-body">
          <p *ngIf="!row()?.published">{{ 'web.publishAsk' | translate }}</p>
          <ng-container *ngIf="row()?.published">
            <p class="ok">{{ 'web.isLive' | translate }}</p>
            <input readonly [value]="url()" (focus)="$any($event.target).select()" />
            <div class="ract"><button class="sm" (click)="copyUrl()"><app-icon name="copy" [size]="13"></app-icon>{{ (copied ? 'invite.copied' : 'invite.copy') | translate }}</button>
              <a class="sm btn-l" [href]="url()" target="_blank" rel="noopener"><app-icon name="external" [size]="13"></app-icon>{{ 'web.open' | translate }}</a></div>
          </ng-container>
          <p class="flash bad" *ngIf="pubError">{{ pubError }}</p>
        </div>
        <div class="modal-foot"><button *ngIf="row()?.published" (click)="unpublish()" class="danger-i">{{ 'web.unpublish' | translate }}</button><button (click)="pub = false">{{ 'common.cancel' | translate }}</button>
          <button class="primary" (click)="doPublish()" [disabled]="busy">{{ (row()?.published ? 'web.republish' : 'web.publish') | translate }}</button></div>
      </div>
    </div>
  </div>
  <ng-template #loading><div class="empty">{{ (loadError ? 'common.error' : 'common.loading') | translate }}</div></ng-template>
  `,
  styles: [`
    :host { display: block; }
    .ds { display: flex; flex-direction: column; height: calc(100vh - 112px); min-height: 560px; margin: -4px 0 0; }
    .bar { display: flex; align-items: center; gap: 8px; padding: 8px 4px 10px; flex-wrap: wrap; } .sp { flex: 1; } .nm { width: 220px; font-weight: 650; } .state { font-size: 12px; min-width: 70px; }
    .seg { display: inline-flex; border: 1px solid var(--line, #ddd); border-radius: 10px; overflow: hidden; } .seg button { border: 0; background: transparent; padding: 6px 10px; cursor: pointer; color: inherit; } .seg .on { background: var(--brand, #4f46e5); color: #fff; }
    .body { flex: 1; display: grid; grid-template-columns: 290px 1fr 300px; gap: 10px; min-height: 0; }
    .left, .right { background: var(--card, #fff); border: 1px solid var(--line, #e5e5e5); border-radius: 14px; overflow: hidden; display: flex; min-height: 0; }
    .left { flex-direction: row; } .right { flex-direction: column; padding: 12px; overflow: auto; gap: 8px; } .right h4 { margin: 0 0 4px; }
    .ptabs { display: flex; flex-direction: column; border-inline-end: 1px solid var(--line, #eee); width: 56px; flex: none; }
    .ptabs button { border: 0; background: transparent; padding: 10px 2px; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; color: inherit; opacity: .65; } .ptabs button small { font-size: 9.5px; } .ptabs .on { opacity: 1; color: var(--brand, #4f46e5); background: rgba(99,102,241,.08); }
    .pbody { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .hint { font-size: 12px; margin: 0; } .pal { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pal button { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 6px; border: 1px solid var(--line, #ddd); border-radius: 10px; background: transparent; cursor: grab; color: inherit; font-size: 12px; } .pal button:hover { border-color: var(--brand, #4f46e5); }
    .layers { display: flex; flex-direction: column; gap: 4px; min-height: 40px; } .ly { display: flex; align-items: center; gap: 4px; padding: 6px 6px; border: 1px solid var(--line, #eee); border-radius: 8px; cursor: pointer; font-size: 12.5px; } .ly.on { border-color: var(--brand, #4f46e5); background: rgba(99,102,241,.08); } .ly .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xs { padding: 2px 4px; } .pg { display: flex; align-items: center; gap: 2px; border: 1px solid var(--line, #eee); border-radius: 8px; padding: 2px 4px; } .pg.on { border-color: var(--brand, #4f46e5); } .pgn { flex: 1; text-align: start; border: 0; background: transparent; padding: 6px; cursor: pointer; color: inherit; }
    .fld { display: flex; flex-direction: column; gap: 4px; } .fld.chk label { display: flex; gap: 8px; align-items: center; } .fld input[type=color] { height: 34px; padding: 2px; }
    .imgf { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; } .imgf input:not([hidden]) { flex: 1 1 100%; } .thumb { width: 44px; height: 34px; border-radius: 6px; background: var(--soft, #eee) center/cover; border: 1px solid var(--line, #ddd); } .thumb.s { width: 40px; height: 40px; flex: none; }
    .up { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border: 1px solid var(--line, #ddd); border-radius: 8px; cursor: pointer; font-size: 12.5px; } .up.xs { padding: 4px 6px; }
    .list { display: flex; flex-direction: column; gap: 8px; } .li { border: 1px solid var(--line, #eee); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: rgba(0,0,0,.02); } .lih { display: flex; align-items: center; gap: 2px; }
    .prods { display: flex; flex-direction: column; gap: 8px; } .pr { display: flex; gap: 8px; align-items: center; border: 1px solid var(--line, #eee); border-radius: 8px; padding: 6px; } .pi { flex: 1; display: flex; flex-direction: column; min-width: 0; gap: 2px; } .pi input { font-size: 12px; padding: 3px 6px; }
    .canvas { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #e5e7eb; border-radius: 14px; overflow: hidden; }
    .tabsbar { display: flex; gap: 4px; padding: 6px 8px; background: #d1d5db; overflow-x: auto; } .tabsbar button { border: 0; border-radius: 8px; padding: 5px 12px; background: transparent; cursor: pointer; color: #111; white-space: nowrap; } .tabsbar .on { background: #fff; font-weight: 600; }
    .frame { flex: 1; display: flex; justify-content: center; min-height: 0; padding: 0; } .frame iframe { width: 100%; height: 100%; border: 0; background: #fff; }
    .canvas.t .frame iframe { width: 820px; max-width: 100%; margin: 12px 0; border-radius: 12px; height: calc(100% - 24px); } .canvas.m .frame iframe { width: 390px; max-width: 100%; margin: 12px 0; border-radius: 22px; height: calc(100% - 24px); box-shadow: 0 0 0 8px #111827; }
    .ract { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; } .btn-l { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border: 1px solid var(--line, #ddd); border-radius: 8px; text-decoration: none; color: inherit; } .ok { color: #16a34a; font-weight: 600; }
    @media (max-width: 1100px) { .body { grid-template-columns: 250px 1fr; } .right { position: fixed; inset-inline-end: 12px; bottom: 12px; top: 140px; width: 300px; z-index: 20; box-shadow: 0 10px 40px rgba(0,0,0,.25); } }
  `]
})
export class WebsiteDesignerComponent implements OnInit, OnDestroy {
  d = signal<SiteDesign | null>(null);
  row = signal<SiteRow | null>(null);
  pageId = signal(''); sel = signal(''); panel = signal<Panel>('add'); device = signal<Device>('desktop');
  name = ''; dirty = false; saving = false; loadError = false; canEdit = false;
  undoStack: string[] = []; redoStack: string[] = [];
  defs = BLOCK_DEFS;
  panels: { k: Panel; i: string; l: string }[] = [{ k: 'add', i: 'plus', l: 'web.p.add' }, { k: 'layers', i: 'grid', l: 'web.p.layers' }, { k: 'pages', i: 'file', l: 'web.p.pages' }, { k: 'theme', i: 'sparkles', l: 'web.p.theme' }, { k: 'shop', i: 'store', l: 'web.p.shop' }];
  dragType = ''; dragFrom = -1; newPageTitle = ''; syncing = false; syncError = '';
  pub = false; busy = false; pubError = ''; copied = false;
  srcdoc = signal<SafeHtml>('');

  page = computed(() => { const d = this.d(); return d ? (d.pages.find(p => p.id === this.pageId()) ?? d.pages[0]) : undefined; });
  block = computed(() => this.page()?.blocks.find(b => b.id === this.sel()));
  url = computed(() => this.row() ? this.web.publicUrl(this.row()!.slug) : '');

  private saveTimer: any; private renderTimer: any; private lastKey = ''; private lastAt = 0; private scrollY = 0;
  private onMsg = (e: MessageEvent) => {
    const m = e.data; if (!m || typeof m !== 'object' || !('wb' in m)) return;
    this.zone.run(() => {
      if (m.wb === 'select') { this.sel.set(String(m.id)); }
      else if (m.wb === 'goto') { const p = this.d()?.pages.find(x => x.path === m.path); if (p) { this.pageId.set(p.id); this.sel.set(''); } }
      else if (m.wb === 'scroll') this.scrollY = Number(m.y) || 0;
    });
  };

  constructor(private route: ActivatedRoute, private router: Router, public web: WebsiteService, public auth: AuthService, private i18n: I18nService,
              private ctx: ErpContextService, private pos: PosService, private san: DomSanitizer, private zone: NgZone) {}

  ngOnInit() {
    window.addEventListener('message', this.onMsg);
    this.canEdit = this.auth.can('web.edit');
    this.web.get(this.route.snapshot.paramMap.get('id') ?? '').subscribe({
      next: s => {
        const d = this.normalize(s.design);
        this.row.set(s); this.name = s.name; this.d.set(d); this.pageId.set(d.pages[0].id); this.queueRender();
      },
      error: () => this.loadError = true
    });
  }
  ngOnDestroy() { window.removeEventListener('message', this.onMsg); clearTimeout(this.saveTimer); clearTimeout(this.renderTimer); if (this.dirty && this.canEdit) this.saveNow(); }

  /** a design saved by an older version (or an empty one) still opens */
  private normalize(x: any): SiteDesign {
    const d: SiteDesign = x && x.pages ? x : { pages: [], theme: {} } as any;
    d.theme = { ...DEFAULT_THEME, ...(d.theme ?? {}) };
    d.settings = { title: this.name || 'My site', lang: 'en', dir: 'ltr', ...((d.settings ?? {}) as object) } as any;
    d.shop = { enabled: false, currency: this.row()?.currency ?? defaultCurrency(), products: [], ...((d.shop ?? {}) as object) } as any;
    if (!d.pages?.length) d.pages = [{ id: uid(), path: '/', title: 'Home', blocks: [newBlock('nav'), newBlock('hero'), newBlock('footer')] }];
    return d;
  }

  // ---------------- rendering ----------------
  private opts(mode: 'preview' | 'publish' | 'download') {
    const d = this.d()!;
    return { mode, labels: d.settings.dir === 'rtl' ? AR_LABELS : {} } as any;
  }
  queueRender() {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      const d = this.d(); if (!d) return;
      const html = renderSite(d, { ...this.opts('preview'), page: this.page()?.path, selected: this.sel(), scrollY: this.scrollY });
      this.srcdoc.set(this.san.bypassSecurityTrustHtml(html));
    }, 90);
  }

  // ---------------- editing (every change goes through here) ----------------
  private snapshot() { return JSON.stringify(this.d()); }
  private pushUndo() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack = []; }
  /** change a property; typing in one field is one undo step */
  set(obj: any, key: string, value: any) {
    if (!this.canEdit) return;
    const k = (obj?.id ?? '') + ':' + key, now = Date.now();
    if (k !== this.lastKey || now - this.lastAt > 1200) this.pushUndo();
    this.lastKey = k; this.lastAt = now;
    obj[key] = value; this.changed();
  }
  private apply(fn: () => void) { if (!this.canEdit) return; this.pushUndo(); this.lastKey = ''; fn(); this.changed(); }
  private changed() { this.d.set({ ...this.d()! }); this.dirty = true; this.queueSave(); this.queueRender(); }
  undo() { const s = this.undoStack.pop(); if (!s) return; this.redoStack.push(this.snapshot()); this.restore(s); }
  redo() { const s = this.redoStack.pop(); if (!s) return; this.undoStack.push(this.snapshot()); this.restore(s); }
  private restore(s: string) { const d = JSON.parse(s) as SiteDesign; this.d.set(d); if (!d.pages.some(p => p.id === this.pageId())) this.pageId.set(d.pages[0].id); this.dirty = true; this.queueSave(); this.queueRender(); }

  isData(v: unknown) { return typeof v === 'string' && v.startsWith('data:'); }
  fieldsOf(b: Block): FieldDef[] { return blockDef(b.type)?.fields ?? []; }
  label(t: string) { return blockDef(t)?.label ?? t; }
  icon(t: string) { return blockDef(t)?.icon ?? 'grid'; }
  select(id: string) { this.sel.set(id); this.queueRender(); }

  addBlock(type: string, at?: number) {
    this.apply(() => {
      const pg = this.page()!, b = newBlock(type);
      const lastFooter = pg.blocks.length && pg.blocks[pg.blocks.length - 1].type === 'footer';
      const selIdx = pg.blocks.findIndex(x => x.id === this.sel());
      const idx = at ?? (selIdx >= 0 ? selIdx + 1 : lastFooter ? pg.blocks.length - 1 : pg.blocks.length);
      pg.blocks.splice(idx, 0, b); this.sel.set(b.id);
    });
  }
  move(i: number, dir: number) { this.apply(() => { const bl = this.page()!.blocks, j = i + dir; if (j < 0 || j >= bl.length) return; [bl[i], bl[j]] = [bl[j], bl[i]]; }); }
  dup(i: number) { this.apply(() => { const bl = this.page()!.blocks, c = JSON.parse(JSON.stringify(bl[i])) as Block; c.id = uid(); bl.splice(i + 1, 0, c); this.sel.set(c.id); }); }
  del(i: number) { this.apply(() => { const bl = this.page()!.blocks; if (bl[i]?.id === this.sel()) this.sel.set(''); bl.splice(i, 1); }); }
  dupSel() { const i = this.page()!.blocks.findIndex(b => b.id === this.sel()); if (i >= 0) this.dup(i); }
  delSel() { const i = this.page()!.blocks.findIndex(b => b.id === this.sel()); if (i >= 0) this.del(i); }
  dropAt(to: number) {
    if (!this.canEdit) return;
    if (this.dragType) { this.addBlock(this.dragType, to); this.dragType = ''; return; }
    if (this.dragFrom >= 0) { const from = this.dragFrom; this.dragFrom = -1; this.apply(() => { const bl = this.page()!.blocks, [b] = bl.splice(from, 1); bl.splice(to > from ? to - 1 : to, 0, b); }); }
  }
  moveItem(list: any[], i: number, dir: number) { this.apply(() => { const j = i + dir; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; }); }
  delItem(list: any[], i: number) { this.apply(() => list.splice(i, 1)); }
  addItem(list: any[], def: any) { this.apply(() => list.push(JSON.parse(JSON.stringify(def ?? {})))); }

  // pages
  addPage() {
    const title = this.newPageTitle.trim(); if (!title) return;
    this.apply(() => {
      const d = this.d()!; let path = '/' + (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page'); let n = 2; const base = path;
      while (d.pages.some(p => p.path === path)) path = base + '-' + n++;
      const home = d.pages[0], cp = (t: string) => { const s = home.blocks.find(b => b.type === t); if (!s) return []; const c = JSON.parse(JSON.stringify(s)) as Block; c.id = uid(); return [c]; };
      const pg: Page = { id: uid(), path, title, blocks: [...cp('nav'), { ...newBlock('text'), props: { ...newBlock('text').props, heading: title } }, ...cp('footer')] };
      d.pages.push(pg); this.pageId.set(pg.id); this.sel.set(''); this.newPageTitle = '';
    });
  }
  setPath(pg: Page, v: string) { let p = String(v ?? '').trim(); if (!p.startsWith('/')) p = '/' + p; p = p.replace(/[^a-zA-Z0-9\-_\/]/g, '-'); if (this.d()!.pages.some(x => x !== pg && x.path === p)) return; this.set(pg, 'path', p); }
  movePage(i: number, dir: number) { this.apply(() => { const l = this.d()!.pages, j = i + dir; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; }); }
  delPage(p: Page) { this.apply(() => { const d = this.d()!; d.pages = d.pages.filter(x => x !== p); if (this.pageId() === p.id) this.pageId.set(d.pages[0].id); }); }
  setLang(dir: string) { this.apply(() => { const d = this.d()!; d.settings.dir = dir as any; d.settings.lang = dir === 'rtl' ? 'ar' : 'en'; if (dir === 'rtl') d.theme.font = 'arabic'; }); }

  // images: resized in the browser so the design stays small
  upload(obj: any, key: string, ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = '';
    if (!f || !f.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (f.type === 'image/svg+xml' || f.size < 60_000) { this.apply(() => obj[key] = String(reader.result)); return; }
      const im = new Image();
      im.onload = () => {
        const max = 1400, k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
        this.apply(() => obj[key] = c.toDataURL('image/jpeg', 0.82));
      };
      im.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  }

  // shop: products come from the point of sale catalogue
  syncProducts() {
    this.syncing = true; this.syncError = '';
    this.pos.records('product', { company: this.ctx.company(), take: 5000 }).subscribe({
      next: list => {
        this.syncing = false;
        this.apply(() => {
          const old = new Map(this.d()!.shop.products.map(p => [p.sku, p]));
          this.d()!.shop.products = list.filter(r => r.code && r.status !== 'inactive').map(r => {
            const prev = old.get(r.code!);
            return { sku: r.code!, name: String(r.data['name'] ?? r.code), price: Number(r.data['price']) || 0, category: String(r.data['category'] ?? ''), description: prev?.description ?? '', image: prev?.image ?? (typeof r.data['image'] === 'string' ? r.data['image'] : '') } as ShopItem;
          });
          this.d()!.shop.enabled = true;
        });
      },
      error: () => { this.syncing = false; this.syncError = this.i18n.t('web.syncFail'); }
    });
  }

  // ---------------- save / preview / download / publish ----------------
  queueSave() { clearTimeout(this.saveTimer); if (!this.canEdit) return; this.saveTimer = setTimeout(() => this.saveNow(), 1800); }
  saveNow(then?: () => void) {
    const id = this.row()?.id; if (!id || !this.d() || !this.canEdit) { then?.(); return; }
    clearTimeout(this.saveTimer); this.saving = true;
    this.web.save(id, this.name || 'Site', this.d()!).subscribe({
      next: r => { this.saving = false; this.dirty = false; this.row.set({ ...this.row()!, ...r }); then?.(); },
      error: e => { this.saving = false; this.pubError = typeof e.error === 'string' && e.error ? e.error : this.i18n.t('common.error'); this.pub = this.pub; }
    });
  }
  private fullHtml(mode: 'download' | 'publish') {
    const r = this.row()!;
    return renderSite(this.d()!, { ...this.opts(mode), orderUrl: r.published ? this.web.orderUrl(r.slug) : undefined, messageUrl: r.published ? this.web.messageUrl(r.slug) : undefined });
  }
  previewTab() { const u = URL.createObjectURL(new Blob([renderSite(this.d()!, this.opts('download'))], { type: 'text/html' })); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }
  download() {
    const u = URL.createObjectURL(new Blob([this.fullHtml('download')], { type: 'text/html' }));
    const a = document.createElement('a'); a.href = u; a.download = (this.row()!.slug || 'site') + '.html'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 5000);
  }
  openPublish() { this.pubError = ''; this.copied = false; this.pub = true; }
  doPublish() {
    this.busy = true; this.pubError = '';
    const r = this.row()!, d = this.d()!;
    this.saveNow(() => {
      const html = renderSite(d, { ...this.opts('publish'), orderUrl: this.web.orderUrl(r.slug), messageUrl: this.web.messageUrl(r.slug) });
      this.web.publish(r.id, html, d.shop.products.map(p => ({ sku: p.sku, name: p.name, price: p.price })), d.shop.currency).subscribe({
        next: x => { this.busy = false; this.row.set({ ...r, ...x }); },
        error: e => { this.busy = false; this.pubError = typeof e.error === 'string' && e.error ? e.error : this.i18n.t('common.error'); }
      });
    });
  }
  unpublish() { this.web.unpublish(this.row()!.id).subscribe(x => this.row.set({ ...this.row()!, ...x })); }
  copyUrl() { navigator.clipboard?.writeText(this.url()).then(() => this.copied = true).catch(() => {}); }
  back() { this.router.navigate(['/website']); }

  @HostListener('window:keydown', ['$event']) onKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); this.saveNow(); }
    else if (k === 'z' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
  }
}
