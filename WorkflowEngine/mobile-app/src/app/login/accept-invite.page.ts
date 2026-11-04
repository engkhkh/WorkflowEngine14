import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonItem, IonInput, IonList, IonButton, IonText } from '@ionic/angular/standalone';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ErpDataService } from '../core/erp-data.service';
import { TranslatePipe } from '../core/translate.pipe';

/** Public page behind the invitation link: choose a password and get signed in. */
@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IonContent, IonItem, IonInput, IonList, IonButton, IonText],
  template: `
    <ion-content class="ion-padding">
      <div class="box">
        <ng-container *ngIf="info; else bad">
          <h2>{{ 'invite.welcome' | translate: { name: info.displayName } }}</h2>
          <p>{{ 'invite.join' | translate: { ws: info.workspace } }} · {{ info.username }}</p>
          <ion-list lines="full">
            <ion-item><ion-input [label]="'invite.choosePassword' | translate" labelPlacement="stacked" type="password" [(ngModel)]="pw"></ion-input></ion-item>
            <ion-item><ion-input [label]="'invite.confirm' | translate" labelPlacement="stacked" type="password" [(ngModel)]="pw2"></ion-input></ion-item>
          </ion-list>
          <ion-text color="danger" *ngIf="error"><p>{{ error }}</p></ion-text>
          <ion-button expand="block" [disabled]="busy" (click)="go()">{{ 'invite.activate' | translate }}</ion-button>
        </ng-container>
        <ng-template #bad><h2>{{ (loading ? 'common.loading' : 'invite.invalid') | translate }}</h2></ng-template>
      </div>
    </ion-content>
  `,
  styles: [`.box { max-width: 420px; margin: 8vh auto 0; }`]
})
export class AcceptInvitePage implements OnInit {
  token = ''; info: { username: string; displayName: string; workspace: string } | null = null;
  loading = true; busy = false; error = ''; pw = ''; pw2 = '';
  constructor(private route: ActivatedRoute, private auth: AuthService, private router: Router, private i18n: I18nService, private data: ErpDataService) {}
  ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) { this.loading = false; return; }
    this.auth.inviteInfo(this.token).subscribe({ next: i => { this.info = i; this.loading = false; }, error: () => this.loading = false });
  }
  go() {
    if (this.pw.length < 6) { this.error = this.i18n.t('invite.short'); return; }
    if (this.pw !== this.pw2) { this.error = this.i18n.t('invite.mismatch'); return; }
    this.busy = true; this.error = '';
    this.auth.acceptInvite(this.token, this.pw).subscribe({
      next: () => { this.busy = false; this.data.loadedOnce.set(false); this.router.navigate(['/tabs/home'], { replaceUrl: true }); },
      error: () => { this.busy = false; this.error = this.i18n.t('invite.invalid'); }
    });
  }
}
