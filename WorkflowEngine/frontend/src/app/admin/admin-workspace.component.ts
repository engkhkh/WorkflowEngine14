import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrgService } from '../core/org.service';
import { AuthService } from '../core/auth.service';
import { TranslatePipe } from '../core/translate.pipe';

/** SaaS workspace card: which plan and how much of it is used. */
@Component({
  selector: 'app-admin-workspace',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <p class="dim lead">{{ 'ws.sub' | translate }}</p>
    <div class="card" *ngIf="org.tenant() as t">
      <div class="card-head"><h3>{{ t.name }} <span class="sub mono">{{ 'ws.id' | translate }}: {{ t.id }}</span></h3>
        <span class="plan" [attr.data-plan]="t.plan">{{ 'ws.plan.' + t.plan | translate }}</span></div>
      <div class="card-body">
        <h4>{{ 'ws.usage' | translate }}</h4>
        <div class="meters">
          <div class="meter" *ngFor="let m of meters(t)">
            <div class="mh"><span>{{ m.label | translate }}</span>
              <strong>{{ m.max ? ('ws.of' | translate: { used: m.used, max: m.max }) : (m.used + ' · ' + ('ws.unlimited' | translate)) }}</strong></div>
            <div class="bar"><i [style.width.%]="m.max ? min(100, m.used / m.max * 100) : 8" [class.full]="m.max && m.used >= m.max"></i></div>
          </div>
        </div>
        <p class="note">{{ 'ws.note' | translate }}</p>
      </div>
    </div>
    <div class="empty" *ngIf="!org.tenant()">{{ 'common.noData' | translate }}</div>
  `,
  styles: [`
    .lead { margin: 0 0 14px; font-size: 13px; }
    h4 { margin: 0 0 12px; font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .05em; }
    :host-context(html[dir="rtl"]) h4 { text-transform: none; letter-spacing: 0; }
    .plan { padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 650; background: var(--primary-soft); color: var(--primary); }
    .meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
    .mh { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; gap: 8px; }
    .bar { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--primary); border-radius: 999px; }
    .bar i.full { background: var(--bad); }
    .note { margin: 20px 0 0; font-size: 12.5px; color: var(--text-dim); }
  `]
})
export class AdminWorkspaceComponent implements OnInit {
  constructor(public org: OrgService, private auth: AuthService) {}
  ngOnInit() { this.org.load().subscribe(); }
  min = Math.min;
  meters(t: any) {
    return [
      { label: 'ws.users', used: t.users, max: t.maxUsers },
      { label: 'org.companies', used: t.companies, max: t.maxCompanies },
      { label: 'org.branches', used: t.branches, max: t.maxBranches },
    ];
  }
}
