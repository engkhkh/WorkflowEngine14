import { AfterViewChecked, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ErpDataService } from '../core/erp-data.service';
import { I18nService } from '../core/i18n.service';
import { AuthService } from '../core/auth.service';
import { TranslatePipe } from '../core/translate.pipe';
import { ASSISTANT_SUGGESTIONS, AssistantReply, answer } from '../core/erp-assistant';
import { IconComponent } from '../shared/icon.component';

interface Msg { from: 'me' | 'ai'; text: string; reply?: AssistantReply; }

/** Shared chat UI - used full-page (/assistant) and in the floating panel on every screen. */
@Component({
  selector: 'app-assistant-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, IconComponent],
  template: `
    <div class="chat" [class.compact]="compact">
      <div class="log" #log>
        <div class="msg ai" *ngIf="messages.length === 0">
          <div class="bubble">
            <p>{{ intro.text }}</p>
            <ul><li *ngFor="let b of intro.bullets">{{ b }}</li></ul>
          </div>
        </div>
        <div class="msg" *ngFor="let m of messages" [class.me]="m.from === 'me'" [class.ai]="m.from === 'ai'">
          <div class="bubble">
            <p>{{ m.text }}</p>
            <ul *ngIf="m.reply?.bullets?.length"><li *ngFor="let b of m.reply!.bullets">{{ b }}</li></ul>
            <a *ngIf="m.reply?.link as l" class="go" [routerLink]="l.route">{{ l.label }} <app-icon name="arrow" [size]="13" class="flip-rtl" /></a>
          </div>
        </div>
        <div class="msg ai" *ngIf="thinking"><div class="bubble typing"><span></span><span></span><span></span></div></div>
      </div>

      <div class="suggest">
        <button *ngFor="let s of suggestions" (click)="ask(s)">{{ s }}</button>
      </div>

      <form class="ask" (ngSubmit)="ask(draft)">
        <input [(ngModel)]="draft" name="q" [placeholder]="'ai.placeholder' | translate" autocomplete="off" />
        <button class="primary" type="submit" [disabled]="!draft.trim()"><app-icon name="send" [size]="15" class="flip-rtl" /></button>
      </form>
      <div class="note">{{ 'ai.grounded' | translate }}</div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .chat { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
    .msg { display: flex; }
    .msg.me { justify-content: flex-end; }
    .bubble { max-width: 86%; padding: 10px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.5; background: var(--panel-3); }
    .msg.me .bubble { background: var(--accent); color: #fff; border-end-end-radius: 4px; }
    .msg.ai .bubble { border-end-start-radius: 4px; }
    .bubble p { margin: 0; }
    .bubble ul { margin: 6px 0 0; padding-inline-start: 18px; }
    .bubble li { margin: 2px 0; }
    .go { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 12.5px; font-weight: 600; text-decoration: none; }
    .typing { display: flex; gap: 4px; }
    .typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint); animation: blink 1s infinite; }
    .typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }
    .suggest { display: flex; gap: 6px; padding: 0 16px 10px; flex-wrap: wrap; }
    .suggest button { font-size: 12px; padding: 5px 10px; border-radius: 999px; background: var(--accent-soft); border-color: transparent; color: var(--accent); }
    .compact .suggest { flex-wrap: nowrap; overflow-x: auto; }
    .compact .suggest button { white-space: nowrap; }
    .ask { display: flex; gap: 8px; padding: 0 16px; }
    .ask button { padding: 8px 12px; }
    .note { font-size: 11px; color: var(--text-faint); padding: 6px 16px 12px; }
  `]
})
export class AssistantChatComponent implements AfterViewChecked {
  @Input() compact = false;
  @ViewChild('log') log?: ElementRef<HTMLDivElement>;
  messages: Msg[] = [];
  draft = '';
  thinking = false;
  private scrollPending = false;

  constructor(private erp: ErpDataService, public i18n: I18nService, private auth: AuthService) {}

  get suggestions(): string[] { return ASSISTANT_SUGGESTIONS[this.i18n.lang()]; }
  get intro(): AssistantReply { return this.reply(''); }

  ask(q: string) {
    const question = (q || '').trim();
    if (!question) return;
    this.messages.push({ from: 'me', text: question });
    this.draft = '';
    this.thinking = true;
    this.scrollPending = true;
    // Small delay so the reply reads as a response rather than an instant swap.
    setTimeout(() => {
      const r = this.reply(question);
      this.messages.push({ from: 'ai', text: r.text, reply: r });
      this.thinking = false;
      this.scrollPending = true;
    }, 350);
  }

  private reply(q: string): AssistantReply {
    return answer(q, {
      docs: this.erp.docs(), myDocs: this.erp.myDocs(), tasks: this.erp.sortedTasks(), kpis: this.erp.kpis(),
      lang: this.i18n.lang(), money: n => this.erp.money(n), user: this.auth.currentUser()?.username,
    });
  }

  ngAfterViewChecked() {
    if (this.scrollPending && this.log) {
      this.log.nativeElement.scrollTop = this.log.nativeElement.scrollHeight;
      this.scrollPending = false;
    }
  }
}
