import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ErpDataService } from '../core/erp-data.service';
import { TranslatePipe } from '../core/translate.pipe';

/** Public page behind the invitation link: the invited person chooses a password and is signed in. */
@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <div class="box">
      <div class="logo">W</div>
      <ng-container *ngIf="info; else bad">
        <h2>{{ 'invite.welcome' | translate: { name: info.displayName } }}</h2>
        <p class="dim">{{ 'invite.join' | translate: { ws: info.workspace } }} · <span class="mono">{{ info.username }}</span></p>
        <form (ngSubmit)="go()">
          <label class="lbl">{{ 'invite.choosePassword' | translate }}</label>
          <input type="password" [(ngModel)]="pw" name="pw" autocomplete="new-password" />
          <label class="lbl">{{ 'invite.confirm' | translate }}</label>
          <input type="password" [(ngModel)]="pw2" name="pw2" autocomplete="new-password" />
          <p class="err" *ngIf="error">{{ error }}</p>
          <button class="primary" type="submit" [disabled]="busy">{{ 'invite.activate' | translate }}</button>
        </form>
      </ng-container>
      <ng-template #bad><h2>{{ (loading ? 'common.loading' : 'invite.invalid') | translate }}</h2></ng-template>
    </div>
  `,
  styles: [`
    :host { display: grid; place-items: center; min-height: 100vh; padding: 16px; }
    .box { width: min(420px, 100%); background: var(--card, #fff); border: 1px solid var(--line, #e5e5e5); border-radius: 14px; padding: 28px; }
    .logo { width: 40px; height: 40px; border-radius: 10px; background: var(--brand, #4f46e5); color: #fff; display: grid; place-items: center; font-weight: 700; margin-bottom: 12px; }
    input { width: 100%; margin-bottom: 10px; } .primary { width: 100%; margin-top: 6px; } .err { color: #b91c1c; }
  `]
})
export class AcceptInviteComponent implements OnInit {
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
      next: () => { this.busy = false; this.data.loadedOnce.set(false); this.router.navigate(['/dashboard']); },
      error: () => { this.busy = false; this.error = this.i18n.t('invite.invalid'); }
    });
  }
}
