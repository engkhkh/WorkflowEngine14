import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { CollabFile, CollabNote, CollabService } from '../core/collab.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe } from './ui';
import { errMsg } from '../hr/hr-util';

/** Notes, activity log and file attachments of one record (works for every module). The server checks the caller's module privileges. */
@Component({
  selector: 'app-chatter',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LocalDatePipe],
  template: `
    <div class="ch">
      <div class="tabs"><button [class.on]="tab() === 'notes'" type="button" (click)="tab.set('notes')"><app-icon name="message" [size]="14"></app-icon>{{ 'collab.notes' | translate }} <b>{{ notes().length }}</b></button>
        <button [class.on]="tab() === 'files'" type="button" (click)="tab.set('files')"><app-icon name="paperclip" [size]="14"></app-icon>{{ 'collab.files' | translate }} <b>{{ files().length }}</b></button></div>
      <p class="flash bad" *ngIf="error">{{ error }}</p>

      <ng-container *ngIf="tab() === 'notes'">
        <div class="compose"><textarea rows="2" [(ngModel)]="text" [placeholder]="'collab.notePh' | translate"></textarea>
          <button class="primary sm" type="button" (click)="send()" [disabled]="!text.trim() || busy">{{ 'collab.send' | translate }}</button></div>
        <div class="empty sm" *ngIf="!notes().length">{{ 'collab.noNotes' | translate }}</div>
        <div class="note" *ngFor="let n of notes()" [class.log]="n.system">
          <div class="meta"><b>{{ n.author }}</b><span>{{ n.createdAt | ldate: 'datetime' }}</span>
            <button class="ghost sm x" type="button" *ngIf="!n.system && (n.author === auth.currentUser()?.username || auth.can('admin.users'))" (click)="delNote(n)" [title]="'admin.delete' | translate"><app-icon name="x" [size]="13"></app-icon></button></div>
          <div class="body">{{ n.text }}</div>
        </div>
      </ng-container>

      <ng-container *ngIf="tab() === 'files'">
        <label class="drop"><app-icon name="paperclip" [size]="15"></app-icon> {{ 'collab.attach' | translate }}
          <input type="file" multiple hidden (change)="pick($event)" /></label>
        <small class="dim">{{ 'collab.maxSize' | translate }}</small>
        <div class="empty sm" *ngIf="!files().length">{{ 'collab.noFiles' | translate }}</div>
        <div class="file" *ngFor="let f of files()">
          <button class="link" type="button" (click)="open(f)"><app-icon name="download" [size]="14"></app-icon>{{ f.name }}</button>
          <small class="dim">{{ kb(f.size) }} · {{ f.author }} · {{ f.createdAt | ldate }}</small>
          <button class="ghost sm x" type="button" *ngIf="f.author === auth.currentUser()?.username || auth.can('admin.users')" (click)="delFile(f)"><app-icon name="trash" [size]="14"></app-icon></button>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .ch { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; display: grid; gap: 8px; margin-top: 4px; }
    .tabs { display: flex; gap: 6px; } .tabs button { display: inline-flex; gap: 6px; align-items: center; font-size: 12.5px; padding: 5px 10px; } .tabs button.on { border-color: var(--primary); color: var(--primary); } .tabs b { font-weight: 600; opacity: .7; }
    .compose { display: grid; gap: 6px; justify-items: end; } .compose textarea { width: 100%; }
    .note { padding: 8px 10px; border-radius: 8px; background: var(--surface-2, rgba(128,128,128,.1)); } .note.log { opacity: .75; font-size: 12px; background: transparent; border-inline-start: 3px solid var(--border); border-radius: 0; }
    .meta { display: flex; gap: 10px; align-items: center; font-size: 11.5px; color: var(--muted); } .meta b { color: var(--text); } .meta .x { margin-inline-start: auto; } .body { white-space: pre-wrap; margin-top: 3px; font-size: 13px; word-break: break-word; }
    .drop { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; border: 1px dashed var(--border); border-radius: 8px; padding: 8px 12px; width: fit-content; }
    .file { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; } .link { background: none; border: none; color: var(--primary); display: inline-flex; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; } .file .x { margin-inline-start: auto; color: var(--bad); }
    .empty.sm { padding: 6px 0; font-size: 12.5px; } small.dim { color: var(--muted); }
  `]
})
export class ChatterComponent implements OnChanges {
  @Input({ required: true }) module!: string;      // mfg | prj | crm | ... | hr | fin | pos
  @Input({ required: true }) kind!: string;
  @Input({ required: true }) recordId!: string;

  auth = inject(AuthService); private api = inject(CollabService); private i18n = inject(I18nService);
  tab = signal<'notes' | 'files'>('notes');
  notes = signal<CollabNote[]>([]); files = signal<CollabFile[]>([]);
  text = ''; busy = false; error = '';

  ngOnChanges(c: SimpleChanges) { if (c['recordId'] || c['module'] || c['kind']) this.load(); }
  load() {
    if (!this.recordId) return;
    this.api.notes(this.module, this.kind, this.recordId).subscribe({ next: l => this.notes.set(l), error: e => this.error = errMsg(e, this.i18n) });
    this.api.files(this.module, this.kind, this.recordId).subscribe({ next: l => this.files.set(l), error: () => {} });
  }
  send() {
    const t = this.text.trim(); if (!t) return;
    this.busy = true; this.error = '';
    this.api.addNote(this.module, this.kind, this.recordId, t).subscribe({ next: n => { this.busy = false; this.text = ''; this.notes.update(l => [n, ...l]); }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } });
  }
  delNote(n: CollabNote) { this.api.deleteNote(n.id).subscribe({ next: () => this.notes.update(l => l.filter(x => x.id !== n.id)), error: e => this.error = errMsg(e, this.i18n) }); }

  pick(ev: Event) {
    const input = ev.target as HTMLInputElement; const list = Array.from(input.files ?? []); input.value = '';
    this.error = '';
    for (const f of list) {
      if (f.size > 4 * 1024 * 1024) { this.error = this.i18n.t('collab.tooBig', { name: f.name }); continue; }
      const rd = new FileReader();
      rd.onload = () => {
        const content = String(rd.result).split(',')[1] ?? '';
        this.api.addFile(this.module, this.kind, this.recordId, { name: f.name, type: f.type, content }).subscribe({ next: x => this.files.update(l => [x, ...l]), error: e => this.error = errMsg(e, this.i18n) });
      };
      rd.readAsDataURL(f);
    }
  }
  open(f: CollabFile) {
    this.api.fileBlob(f.id).subscribe({
      next: b => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
  delFile(f: CollabFile) { this.api.deleteFile(f.id).subscribe({ next: () => this.files.update(l => l.filter(x => x.id !== f.id)), error: e => this.error = errMsg(e, this.i18n) }); }
  kb(n: number) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB'; }
}
