import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollabConfig, CollabService } from '../core/collab.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from './ui';
import { errMsg } from '../hr/hr-util';

export interface FilterState { q: string; status: string; }

/** Saved filters of a list: pick one to apply, or save the current search / status filter under a name (optionally shared with the workspace). */
@Component({
  selector: 'app-saved-views',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="sv">
      <select [ngModel]="sel()" (ngModelChange)="choose($event)" [title]="'collab.savedFilters' | translate">
        <option value="">{{ 'collab.savedFilters' | translate }}</option>
        <option *ngFor="let c of list()" [value]="c.id">{{ c.shared && !c.mine ? '👥 ' : '' }}{{ c.name }}</option>
      </select>
      <button type="button" class="ghost sm" (click)="open = !open" [title]="'collab.saveFilter' | translate"><app-icon name="bookmark" [size]="15"></app-icon></button>
      <button type="button" class="ghost sm danger-i" *ngIf="current() && (current()!.mine)" (click)="del()" [title]="'admin.delete' | translate"><app-icon name="trash" [size]="14"></app-icon></button>
    </div>
    <div class="pop" *ngIf="open">
      <input [(ngModel)]="name" [placeholder]="'collab.filterName' | translate" />
      <label class="chk"><input type="checkbox" [(ngModel)]="shared" /> {{ 'collab.shareWorkspace' | translate }}</label>
      <button type="button" class="primary sm" (click)="save()" [disabled]="!name.trim()">{{ 'admin.save' | translate }}</button>
      <small class="bad" *ngIf="error">{{ error }}</small>
    </div>
  `,
  styles: [`
    :host { position: relative; display: inline-block; } .sv { display: flex; gap: 4px; align-items: center; } .sv select { max-width: 180px; } .danger-i { color: var(--bad); }
    .pop { position: absolute; z-index: 30; top: 100%; inset-inline-start: 0; margin-top: 6px; background: var(--surface, #fff); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; display: grid; gap: 8px; width: 260px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
    .chk { display: flex; gap: 8px; align-items: center; font-size: 12.5px; } .chk input { width: auto; } .bad { color: var(--bad); }
  `]
})
export class SavedViewsComponent implements OnChanges {
  @Input({ required: true }) view!: string;                      // unique key of the list, e.g. 'crm:lead'
  @Input({ required: true }) state!: () => FilterState;          // current filter to save
  @Output() apply = new EventEmitter<FilterState>();

  private api = inject(CollabService); private i18n = inject(I18nService);
  list = signal<CollabConfig<FilterState>[]>([]);
  sel = signal(''); open = false; name = ''; shared = false; error = '';
  current = () => this.list().find(c => c.id === this.sel());

  ngOnChanges(c: SimpleChanges) { if (c['view']) this.load(); }
  load() { this.api.configs<FilterState>('filter', this.view).subscribe({ next: l => this.list.set(l), error: () => this.list.set([]) }); }
  choose(id: string) { this.sel.set(id); const c = this.list().find(x => x.id === id); this.apply.emit(c ? { q: c.data?.q ?? '', status: c.data?.status ?? '' } : { q: '', status: '' }); }
  save() {
    this.error = '';
    this.api.saveConfig<FilterState>('filter', this.view, this.name.trim(), this.shared, this.state()).subscribe({
      next: c => { this.list.update(l => [...l.filter(x => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name))); this.sel.set(c.id); this.open = false; this.name = ''; this.shared = false; },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
  del() { const c = this.current(); if (!c) return; this.api.deleteConfig('filter', c.id).subscribe({ next: () => { this.list.update(l => l.filter(x => x.id !== c.id)); this.sel.set(''); } }); }
}
