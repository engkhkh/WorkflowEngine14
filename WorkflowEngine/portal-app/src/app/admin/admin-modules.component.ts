import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PortalApiService } from '../core/portal-api.service';
import { AuthService } from '../core/auth.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';

const META: Record<string, { icon: string; color: string }> = {
  hr: { icon: 'users', color: '#2563eb' }, finance: { icon: 'wallet', color: '#16a34a' }, pos: { icon: 'cart', color: '#f59e0b' },
  mfg: { icon: 'box', color: '#f97316' }, prj: { icon: 'grid', color: '#0ea5e9' }, crm: { icon: 'users', color: '#8b5cf6' },
  proc: { icon: 'cart', color: '#14b8a6' }, scm: { icon: 'globe', color: '#0891b2' }, wh: { icon: 'box', color: '#84cc16' },
  ast: { icon: 'settings', color: '#a16207' }, pay: { icon: 'wallet', color: '#16a34a' }, epm: { icon: 'trending-up', color: '#e11d48' },
  bpm: { icon: 'grid', color: '#7c3aed' }, int: { icon: 'send', color: '#475569' }, bi: { icon: 'bar-chart', color: '#db2777' },
  website: { icon: 'globe', color: '#0ea5e9' }, workflow: { icon: 'flow', color: '#8b5cf6' }, hospital: { icon: 'heart', color: '#dc2626' },
  calendar: { icon: 'calendar', color: '#2563eb' }, muslim: { icon: 'moon', color: '#059669' }, custom: { icon: 'layers', color: '#6366f1' },
};

/** The workspace admin chooses which modules the company uses; users only get privileges of switched-on modules. */
@Component({
  selector: 'app-admin-modules',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent],
  template: `
    <p class="dim">{{ 'mods.hint' | translate }}</p>
    <div class="flash" [class.bad]="bad" *ngIf="msg">{{ msg }}</div>
    <div class="grid">
      <label class="mod" *ngFor="let m of all()" [class.on]="on().has(m)">
        <input type="checkbox" [checked]="on().has(m)" (change)="toggle(m)" />
        <span class="ic" [style.background]="meta(m).color"><app-icon [name]="meta(m).icon"></app-icon></span>
        <span class="nm">{{ 'module.' + m | translate }}</span>
      </label>
    </div>
    <div class="row">
      <button (click)="setAll(true)">{{ 'mods.all' | translate }}</button>
      <button (click)="setAll(false)">{{ 'mods.none' | translate }}</button>
      <span class="sp"></span>
      <button class="primary" [disabled]="saving()" (click)="save()">{{ 'admin.save' | translate }}</button>
    </div>
  `,
  styles: [`
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; margin: 14px 0; }
    .mod { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); cursor: pointer; }
    .mod.on { border-color: var(--accent, #2563eb); }
    .ic { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; color: #fff; }
    .nm { font-weight: 600; font-size: 13px; }
    .row { display: flex; gap: 8px; align-items: center; } .sp { flex: 1; }
    .flash { padding: 8px 12px; border-radius: 8px; background: color-mix(in srgb, var(--green) 14%, var(--panel)); margin-bottom: 8px; } .flash.bad { background: color-mix(in srgb, var(--red, #dc2626) 14%, var(--panel)); }
    .dim { color: var(--text-dim); font-size: 12px; }
  `]
})
export class AdminModulesComponent implements OnInit {
  all = signal<string[]>([]);
  on = signal<Set<string>>(new Set());
  saving = signal(false);
  msg = ''; bad = false;
  constructor(private api: PortalApiService, private auth: AuthService) {}
  meta(m: string) { return META[m] ?? { icon: 'grid', color: '#64748b' }; }
  ngOnInit() { this.api.getModules().subscribe(r => { this.all.set(r.all); this.on.set(new Set(r.enabled)); }); }
  toggle(m: string) { const s = new Set(this.on()); s.has(m) ? s.delete(m) : s.add(m); this.on.set(s); }
  setAll(v: boolean) { this.on.set(new Set(v ? this.all() : [])); }
  save() {
    this.saving.set(true);
    this.api.setModules([...this.on()]).subscribe({
      next: r => { this.on.set(new Set(r.enabled)); this.saving.set(false); this.bad = false; this.msg = '\u2713'; this.auth.refreshMe().subscribe(); },
      error: e => { this.saving.set(false); this.bad = true; this.msg = String(e?.error?.error ?? e?.error ?? e?.message ?? 'Error'); }
    });
  }
}
