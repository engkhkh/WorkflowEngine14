import { AfterViewChecked, Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AssistantService } from '../core/assistant.service';
import { ErpDataService } from '../core/erp-data.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';

@Component({
  selector: 'app-assistant-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, IconComponent],
  template: `
    <div class="wrap" [class.full]="full">
      <div class="msgs" #scroller>
        <div class="msg" *ngFor="let m of ai.messages()" [class.me]="m.from === 'user'">
          <div class="avatar" *ngIf="m.from === 'ai'"><app-icon name="sparkles" [size]="15"></app-icon></div>
          <div class="bubble">
            <div>{{ m.text }}</div>
            <div class="acts" *ngIf="m.actions?.length">
              <a class="act" *ngFor="let a of m.actions" [routerLink]="a.route" [queryParams]="a.queryParams" (click)="navigated()">
                {{ a.label }} <app-icon name="arrow-right" [size]="13"></app-icon>
              </a>
            </div>
          </div>
        </div>
      </div>

      <div class="sugs">
        <button class="sm" *ngFor="let s of ai.suggestions()" (click)="send(s)">{{ s }}</button>
      </div>

      <form class="composer" (ngSubmit)="send(text)">
        <input [(ngModel)]="text" name="q" [placeholder]="'ai.placeholder' | translate" autocomplete="off" />
        <button class="primary" type="submit" [disabled]="!text.trim()"><app-icon name="send" [size]="15"></app-icon></button>
      </form>
      <p class="note">{{ 'ai.note' | translate }}</p>
    </div>
  `,
  styles: [`
    .wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .msgs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .full .msgs { min-height: 360px; max-height: calc(100vh - 340px); }
    .msg { display: flex; gap: 8px; align-items: flex-start; }
    .msg.me { justify-content: flex-end; }
    .avatar { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, var(--primary), #0ea5a4); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
    .bubble { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; font-size: 13px; line-height: 1.55; max-width: 88%; }
    .me .bubble { background: var(--primary); color: var(--primary-contrast); border-color: var(--primary); }
    .acts { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .act { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 7px; background: var(--primary-soft); color: var(--primary); }
    .sugs { display: flex; gap: 6px; padding: 0 16px 10px; flex-wrap: wrap; }
    .sugs button { border-radius: 999px; font-weight: 500; color: var(--text-2); white-space: normal; text-align: start; }
    .composer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
    .note { margin: 0; padding: 0 16px 12px; font-size: 11px; color: var(--text-dim); }
  `]
})
export class AssistantPanelComponent implements OnInit, AfterViewChecked {
  @Input() full = false;
  @ViewChild('scroller') scroller?: ElementRef<HTMLDivElement>;
  text = '';
  private lastCount = 0;

  constructor(public ai: AssistantService, private data: ErpDataService) {}

  ngOnInit() {
    if (!this.data.loadedOnce()) this.data.refresh().subscribe();
    this.ai.ensureGreeting();
  }

  ngAfterViewChecked() {
    const n = this.ai.messages().length;
    if (n !== this.lastCount && this.scroller) {
      this.lastCount = n;
      this.scroller.nativeElement.scrollTop = this.scroller.nativeElement.scrollHeight;
    }
  }

  send(q: string) {
    if (!q.trim()) return;
    this.ai.ask(q);
    this.text = '';
  }

  navigated() { if (!this.full) this.ai.open.set(false); }
}
