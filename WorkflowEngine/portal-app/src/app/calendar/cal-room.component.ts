import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslatePipe } from '../core/translate.pipe';
import { I18nService } from '../core/i18n.service';
import { AuthService } from '../core/auth.service';
import { errMsg } from '../hr/hr-util';
import { CalendarService } from './calendar.service';

/**
 * Meeting room. The video runs on Jitsi Meet (video, audio, chat, screen sharing, raise hand, recording on the server side).
 * The public server meet.jit.si only allows a short demo when embedded in another page, so it is opened in its own tab;
 * a company Jitsi server (set in Calendar > Settings) is embedded right here.
 */
@Component({
  selector: 'app-cal-room',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <div class="card" *ngIf="!error(); else bad">
      <div class="card-head"><h3>🎥 {{ title() || ('cal.kind.meeting' | translate) }}</h3><a routerLink="/calendar/view" class="sm">← {{ 'cal.nav.calendar' | translate }}</a></div>
      <div class="card-body" *ngIf="url()">
        <ng-container *ngIf="embed(); else outside">
          <iframe *ngIf="frame()" [src]="frame()!" allow="camera; microphone; display-capture; fullscreen; autoplay; clipboard-write" class="fr"></iframe>
          <div class="row mt"><button (click)="open()">{{ 'cal.room.newtab' | translate }}</button><button (click)="copy()">{{ 'cal.copyLink' | translate }}</button><span class="dim sm">{{ copied() }}</span></div>
        </ng-container>
        <ng-template #outside>
          <div class="join">
            <p>{{ 'cal.room.help' | translate }}</p>
            <button class="primary big" (click)="open()">🎥 {{ 'cal.room.join' | translate }}</button>
            <div class="row mt"><button (click)="copy()">{{ 'cal.copyLink' | translate }}</button><span class="dim sm">{{ copied() }}</span></div>
            <p class="dim sm mt">{{ 'cal.room.tip' | translate }}</p>
          </div>
        </ng-template>
      </div>
      <div class="card-body" *ngIf="!url()"><p class="dim">{{ 'mus.loading' | translate }}</p></div>
    </div>
    <ng-template #bad><div class="card"><div class="card-body"><p class="flash bad">{{ error() }}</p><a routerLink="/calendar/view">← {{ 'cal.nav.calendar' | translate }}</a></div></div></ng-template>
  `,
  styles: [`
    .fr { width: 100%; height: 70vh; border: 0; border-radius: 10px; background: #000; } .join { text-align: center; padding: 30px 10px; } .big { font-size: 16px; padding: 12px 28px; }
    .row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; } .mt { margin-top: 14px; } .dim { color: var(--text-dim); } .sm { font-size: 12px; }
  `]
})
export class CalRoomComponent implements OnInit {
  private route = inject(ActivatedRoute); private api = inject(CalendarService); private san = inject(DomSanitizer); private i18n = inject(I18nService); private auth = inject(AuthService);
  title = signal(''); url = signal(''); embed = signal(false); frame = signal<SafeResourceUrl | null>(null); error = signal(''); copied = signal('');
  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.api.join(id).subscribe({
      next: r => {
        this.title.set(r.title); const name = this.auth.currentUser()?.displayName || this.auth.currentUser()?.username || '';
        const link = `${r.url}#userInfo.displayName=${encodeURIComponent(JSON.stringify(name))}`;
        this.url.set(link); const own = r.domain !== 'meet.jit.si'; this.embed.set(own);
        if (own) this.frame.set(this.san.bypassSecurityTrustResourceUrl(link));
      },
      error: e => this.error.set(errMsg(e, this.i18n))
    });
  }
  open() { window.open(this.url(), '_blank', 'noopener'); }
  copy() { try { void navigator.clipboard.writeText(this.url().split('#')[0]); this.copied.set('✓'); } catch { this.copied.set(this.url().split('#')[0]); } }
}
