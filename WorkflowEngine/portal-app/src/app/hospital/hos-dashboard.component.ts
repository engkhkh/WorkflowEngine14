import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { HosDashboard, HospitalService } from './hospital.service';
import { HOS_CSS } from './hos-styles';

@Component({
  selector: 'app-hos-dashboard',
  standalone: true,
  imports: [CommonModule, TranslatePipe, NumPipe],
  template: `
    <ng-container *ngIf="d() as d">
      <div class="kpis">
        <div class="card kpi"><span>{{ 'hos.k.apptToday' | translate }}</span><strong>{{ d.appointmentsToday.total }}</strong><small>{{ d.appointmentsToday.checkedIn }} {{ 'hos.s.CheckedIn' | translate }} · {{ d.appointmentsToday.completed }} {{ 'hos.s.Completed' | translate }}</small></div>
        <div class="card kpi"><span>{{ 'hos.k.openVisits' | translate }}</span><strong>{{ d.openVisits }}</strong></div>
        <div class="card kpi"><span>{{ 'hos.k.admitted' | translate }}</span><strong>{{ d.admitted }}</strong></div>
        <div class="card kpi"><span>{{ 'hos.k.occupancy' | translate }}</span><strong>{{ d.beds.occupancyPct }}%</strong><small>{{ d.beds.occupied }} / {{ d.beds.total }} {{ 'hos.k.beds' | translate }}</small></div>
        <div class="card kpi"><span>{{ 'hos.k.pendingLabs' | translate }}</span><strong>{{ d.pendingLabs }}</strong></div>
        <div class="card kpi"><span>{{ 'hos.k.pendingRx' | translate }}</span><strong>{{ d.pendingRx }}</strong></div>
        <div class="card kpi"><span>{{ 'hos.k.revenueToday' | translate }}</span><strong>{{ d.revenueToday | num }} <small>{{ api.currency() }}</small></strong><small>{{ 'hos.k.week' | translate }}: {{ d.revenueWeek | num }}</small></div>
        <div class="card kpi"><span>{{ 'hos.k.outstanding' | translate }}</span><strong>{{ d.outstanding | num }} <small>{{ api.currency() }}</small></strong></div>
      </div>
      <div class="two">
        <div class="card"><div class="card-head"><h3>{{ 'hos.k.last7' | translate }}</h3></div><div class="card-body">
          <div class="bars"><div *ngFor="let x of d.days"><i [style.height.px]="(x.visits / max(d)) * 90"></i>{{ x.visits }}<br>{{ x.day.slice(5) }}</div></div></div></div>
        <div class="card"><div class="card-head"><h3>{{ 'hos.k.topDx' | translate }}</h3></div><div class="card-body">
          <p class="dim" *ngIf="!d.topDiagnoses.length">—</p>
          <div class="row" *ngFor="let x of d.topDiagnoses"><span class="grow">{{ x.name }}</span><span class="chip">{{ x.count }}</span></div></div></div>
      </div>
      <div class="card mt" *ngIf="d.lowStock.length"><div class="card-head"><h3>{{ 'hos.k.lowStock' | translate }}</h3></div>
        <div class="table-wrap"><table class="data"><tbody><tr *ngFor="let x of d.lowStock"><td>{{ x.name }}</td><td class="num">{{ x.stock }}</td><td class="num dim">{{ 'hos.f.reorder' | translate }} {{ x.reorder }}</td></tr></tbody></table></div></div>
    </ng-container>
    <p class="dim" *ngIf="!d() && !err">…</p><p class="flash bad" *ngIf="err">{{ err }}</p>
  `,
  styles: [HOS_CSS]
})
export class HosDashboardComponent implements OnInit {
  api = inject(HospitalService);
  d = signal<HosDashboard | null>(null); err = '';
  ngOnInit() { this.api.loadCfg(); this.api.dashboard().subscribe({ next: x => this.d.set(x), error: () => this.err = '!' }); }
  max(d: HosDashboard) { return Math.max(1, ...d.days.map(x => x.visits)); }
}
