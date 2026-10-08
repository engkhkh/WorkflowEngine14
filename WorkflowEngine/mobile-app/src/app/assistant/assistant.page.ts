import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonFooter, IonButton, IonIcon, IonInput
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { send, sparkles, arrowForward } from 'ionicons/icons';
import { AssistantService, AssistantAction } from '../core/assistant.service';
import { ErpDataService } from '../core/erp-data.service';
import { TranslatePipe } from '../core/translate.pipe';

@Component({
  selector: 'app-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonFooter, IonButton, IonIcon, IonInput],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
        <ion-title>{{ 'ai.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content #content>
      <div class="msg" *ngFor="let m of ai.messages()" [class.me]="m.from === 'user'">
        <span class="av" *ngIf="m.from === 'ai'"><ion-icon name="sparkles"></ion-icon></span>
        <div class="bubble">
          {{ m.text }}
          <div class="acts" *ngIf="m.actions?.length">
            <button *ngFor="let a of m.actions" (click)="go(a)">{{ a.label }} <ion-icon name="arrow-forward"></ion-icon></button>
          </div>
        </div>
      </div>
      <div class="sugs">
        <button *ngFor="let s of ai.suggestions()" (click)="send(s)">{{ s }}</button>
      </div>
      <p class="note">{{ 'ai.note' | translate }}</p>
    </ion-content>
    <ion-footer>
      <ion-toolbar>
        <form class="composer" (ngSubmit)="send(text)">
          <ion-input [(ngModel)]="text" name="q" [placeholder]="'ai.placeholder' | translate" fill="outline"></ion-input>
          <ion-button type="submit" [disabled]="!text.trim()"><ion-icon name="send"></ion-icon></ion-button>
        </form>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [`
    .msg { display: flex; gap: 8px; margin-bottom: 12px; align-items: flex-start; }
    .msg.me { justify-content: flex-end; }
    .av { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #4338ca, #0ea5a4); flex-shrink: 0; }
    .bubble { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; font-size: 14px; line-height: 1.5; max-width: 85%; }
    .me .bubble { background: var(--primary); color: var(--primary-contrast); border-color: var(--primary); }
    .acts { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .acts button { display: inline-flex; align-items: center; gap: 4px; border: none; border-radius: 8px; padding: 5px 10px; font-size: 12.5px; font-weight: 600; background: var(--primary-soft); color: var(--primary); font-family: inherit; }
    .sugs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .sugs button { border: 1px solid var(--border); background: var(--surface); color: var(--text-2); border-radius: 999px; padding: 7px 12px; font-size: 12.5px; font-family: inherit; text-align: start; }
    .note { font-size: 11px; color: var(--text-dim); margin-top: 14px; }
    .composer { display: flex; gap: 8px; align-items: center; padding: 4px 10px; }
    .composer ion-input { --border-radius: 12px; min-height: 42px; }
  `]
})
export class AssistantPage implements OnInit {
  @ViewChild('content') content?: IonContent;
  text = '';
  constructor(public ai: AssistantService, private data: ErpDataService, private router: Router) { addIcons({ send, sparkles, arrowForward }); }

  ngOnInit() {
    if (!this.data.loadedOnce()) this.data.refresh().subscribe();
    this.ai.ensureGreeting();
  }

  send(q: string) {
    if (!q?.trim()) return;
    this.ai.ask(q);
    this.text = '';
    setTimeout(() => this.content?.scrollToBottom(250), 50);
  }

  /** Portal routes -> mobile routes (module pages live under Documents on the phone). */
  go(a: AssistantAction) {
    const r = a.route.join('/').replace(/^\//, '');
    if (r.startsWith('m/') || r === 'dashboard') return this.router.navigate(['/tabs/home']);
    if (r === 'approvals') return this.router.navigate(['/tabs/approvals']);
    if (r === 'reports') return this.router.navigate(['/reports']);
    if (r === 'services') return this.router.navigate(['/services']);
    return this.router.navigate(a.route, { queryParams: a.queryParams });
  }
}
