import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { Employee } from '../core/hr.models';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { HrLeaveComponent } from './hr-leave.component';
import { HrPerformanceComponent } from './hr-performance.component';
import { empName, findRef, initials, refLabel } from './hr-util';

/** Employee self-service: my profile, my leave (balance + requests), my goals & reviews, and the HR request services. Needs hr.self. */
@Component({
  selector: 'app-hr-self',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IconComponent, LocalDatePipe, HrLeaveComponent, HrPerformanceComponent],
  template: `
    <p class="flash bad" *ngIf="missing">{{ 'hr.me.notLinked' | translate }}</p>
    <ng-container *ngIf="me() as e">
      <div class="card head">
        <span class="big">{{ ini(e.fullName) }}</span>
        <div class="who"><h2>{{ name(e) }}</h2><div class="dim">{{ e.position || e.job || '—' }} · {{ unit(e) || '—' }}</div>
          <div class="chips"><span class="chip mono">{{ e.empNo }}</span><span class="chip">{{ 'hr.st.' + e.status | translate }}</span>
            <span class="chip" *ngIf="e.hireDate">{{ 'hr.f.hireDate' | translate }}: {{ e.hireDate | ldate }}</span></div></div>
        <div class="links">
          <a class="btn" routerLink="/m/hr" *ngIf="auth.can('hr.view')"><app-icon name="send" [size]="15"></app-icon>{{ 'hr.requests' | translate }}</a>
          <a class="btn" routerLink="/documents"><app-icon name="file" [size]="15"></app-icon>{{ 'hr.me.myDocs' | translate }}</a>
        </div>
      </div>
      <div class="card"><div class="card-body kv">
        <div><span>{{ 'hr.f.email' | translate }}</span><b>{{ e.email || '—' }}</b></div>
        <div><span>{{ 'hr.f.phone' | translate }}</span><b dir="ltr">{{ e.phone || '—' }}</b></div>
        <div><span>{{ 'hr.f.managerEmpNo' | translate }}</span><b>{{ e.managerEmpNo || '—' }}</b></div>
        <div><span>{{ 'hr.f.location' | translate }}</span><b>{{ e.location || '—' }}</b></div>
      </div></div>
      <h3 class="h">{{ 'hr.nav.leave' | translate }}</h3>
      <app-hr-leave [mine]="true"></app-hr-leave>
      <h3 class="h">{{ 'hr.nav.performance' | translate }}</h3>
      <app-hr-performance [mine]="true"></app-hr-performance>
    </ng-container>
  `,
  styles: [`
    .head { display: flex; align-items: center; gap: 16px; padding: 18px 20px; margin-bottom: 16px; flex-wrap: wrap; }
    .big { width: 62px; height: 62px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-size: 22px; font-weight: 700; }
    .who { flex: 1; min-width: 200px; } .who h2 { font-size: 20px; margin-bottom: 2px; }
    .chips { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; } .links { display: flex; gap: 8px; flex-wrap: wrap; } .btn { text-decoration: none; }
    .kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 4px; }
    .kv div { display: flex; flex-direction: column; font-size: 13px; } .kv span { color: var(--text-dim); font-size: 12px; }
    .h { margin: 26px 0 12px; font-size: 16px; }
  `]
})
export class HrSelfComponent implements OnInit {
  me = signal<Employee | null>(null);
  missing = false;
  constructor(public auth: AuthService, private hr: HrService, private i18n: I18nService) {}
  ngOnInit() { this.hr.me().subscribe({ next: e => this.me.set(e), error: () => this.missing = true }); this.hr.loadRefs(['unit']).subscribe(); }
  name(e: Employee) { return empName(e, this.i18n); }
  ini(n: string) { return initials(n); }
  unit(e: Employee) { return e.unit ? (refLabel(findRef(this.hr.ref('unit'), e.unit), this.i18n) || e.unit) : ''; }
}
