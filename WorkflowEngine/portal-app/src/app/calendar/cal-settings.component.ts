import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../core/translate.pipe';
import { I18nService } from '../core/i18n.service';
import { errMsg } from '../hr/hr-util';
import { CalSettings, CalendarService } from './calendar.service';

@Component({
  selector: 'app-cal-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <div class="card"><div class="card-head"><h3>{{ 'cal.nav.settings' | translate }}</h3></div>
      <div class="card-body form-grid">
        <p class="flash bad full" *ngIf="error()">{{ error() }}</p><p class="flash ok full" *ngIf="saved()">✓</p>
        <label class="full">{{ 'cal.set.domain' | translate }}<input [(ngModel)]="s.jitsiDomain" placeholder="meet.jit.si"><small class="dim">{{ 'cal.set.domain.help' | translate }}</small></label>
        <label>{{ 'cal.set.workStart' | translate }}<input type="time" [(ngModel)]="s.workStart"></label>
        <label>{{ 'cal.set.workEnd' | translate }}<input type="time" [(ngModel)]="s.workEnd"></label>
        <div class="full"><button class="primary" (click)="save()">{{ 'cal.save' | translate }}</button></div>
      </div></div>`,
  styles: [`label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; } .dim { color: var(--text-dim); } .flash.ok { background: var(--ok-soft); color: var(--ok); padding: 8px 12px; border-radius: 8px; }`]
})
export class CalSettingsComponent implements OnInit {
  private api = inject(CalendarService); private i18n = inject(I18nService);
  s: CalSettings = { jitsiDomain: 'meet.jit.si', workStart: '09:00', workEnd: '17:00' }; error = signal(''); saved = signal(false);
  ngOnInit() { this.api.settings().subscribe({ next: s => this.s = s, error: e => this.error.set(errMsg(e, this.i18n)) }); }
  save() { this.error.set(''); this.api.saveSettings(this.s).subscribe({ next: s => { this.s = s; this.saved.set(true); setTimeout(() => this.saved.set(false), 2500); }, error: e => this.error.set(errMsg(e, this.i18n)) }); }
}
