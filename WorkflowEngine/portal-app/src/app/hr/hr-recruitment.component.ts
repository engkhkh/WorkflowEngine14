import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { CANDIDATE_STAGES, Employee, HrRecord } from '../core/hr.models';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { EmployeeFormComponent } from './employee-form.component';
import { errMsg, initials, todayStr } from './hr-util';

/**
 * Recruitment: vacancies and a candidate pipeline (Applied > Screening > Interview > Offer > Hired / Rejected).
 * Hiring a candidate opens the employee form pre-filled (needs hr.employees.manage) and closes the loop to Core HR.
 */
@Component({
  selector: 'app-hr-recruitment',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LocalDatePipe, EmployeeFormComponent],
  template: `
    <div class="flash" [class.bad]="flashBad" *ngIf="flashMsg">{{ flashMsg }}</div>
    <div class="bar">
      <div class="seg">
        <button [class.on]="tab() === 'pipeline'" (click)="tab.set('pipeline')">{{ 'hr.rc.pipeline' | translate }}</button>
        <button [class.on]="tab() === 'vacancies'" (click)="tab.set('vacancies')">{{ 'hr.rc.vacancies' | translate }}</button>
      </div>
      <select *ngIf="tab() === 'pipeline'" [ngModel]="vac()" (ngModelChange)="vac.set($event)">
        <option value="">{{ 'hr.rc.allVacancies' | translate }}</option>
        <option *ngFor="let v of vacancies()" [value]="v.code">{{ v.code }} · {{ v.data['title'] }}</option>
      </select>
      <span class="grow"></span>
      <ng-container *ngIf="canManage">
        <button (click)="openVac(null)"><app-icon name="plus" [size]="15"></app-icon>{{ 'hr.rc.newVacancy' | translate }}</button>
        <button class="primary" (click)="openCand(null)"><app-icon name="plus" [size]="15"></app-icon>{{ 'hr.rc.newCandidate' | translate }}</button>
      </ng-container>
    </div>

    <!-- pipeline board -->
    <div class="board" *ngIf="tab() === 'pipeline'">
      <div class="lane" *ngFor="let s of stages">
        <div class="lane-head"><b>{{ 'hr.rc.st.' + s | translate }}</b><span class="chip">{{ byStage(s).length }}</span></div>
        <div class="cardc" *ngFor="let c of byStage(s)">
          <div class="who"><span class="av">{{ ini(c.data['name']) }}</span><div><strong>{{ c.data['name'] }}</strong><div class="dim">{{ vacTitle(c.data['vacancy']) }}</div></div></div>
          <div class="dim sm" *ngIf="c.data['email']">{{ c.data['email'] }}</div>
          <div class="acts" *ngIf="canManage">
            <button class="sm" *ngIf="idx(s) > 0 && s !== 'Hired' && s !== 'Rejected'" (click)="move(c, idx(s) - 1)">‹</button>
            <button class="sm primary" *ngIf="idx(s) < 3" (click)="move(c, idx(s) + 1)">{{ 'hr.rc.next' | translate }} ›</button>
            <button class="sm success" *ngIf="s === 'Offer' && auth.can('hr.employees.manage')" (click)="hire(c)">{{ 'hr.rc.hire' | translate }}</button>
            <button class="sm" *ngIf="s !== 'Hired' && s !== 'Rejected'" (click)="move(c, 5)">{{ 'hr.rc.reject' | translate }}</button>
            <button class="ghost sm" (click)="openCand(c)"><app-icon name="edit" [size]="14"></app-icon></button>
            <button class="ghost sm danger-i" (click)="removeCand(c)"><app-icon name="trash" [size]="14"></app-icon></button>
          </div>
        </div>
        <p class="dim empty-lane" *ngIf="!byStage(s).length">—</p>
      </div>
    </div>

    <!-- vacancies -->
    <div class="card" *ngIf="tab() === 'vacancies'">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'hr.org.code' | translate }}</th><th>{{ 'hr.rc.title' | translate }}</th><th>{{ 'hr.f.unit' | translate }}</th><th class="num">{{ 'hr.rc.openings' | translate }}</th>
          <th class="num">{{ 'hr.rc.candidates' | translate }}</th><th>{{ 'hr.f.status' | translate }}</th><th></th></tr></thead>
        <tbody><tr *ngFor="let v of vacancies()">
          <td class="mono">{{ v.code }}</td><td><strong>{{ v.data['title'] }}</strong><div class="dim">{{ v.data['location'] }}</div></td><td>{{ v.data['unit'] }}</td>
          <td class="num">{{ v.data['openings'] }}</td><td class="num">{{ candCount(v.code) }}</td>
          <td><span class="chip" [class.ok]="v.status === 'Open'" [class.warn]="v.status === 'OnHold'">{{ 'hr.rc.vs.' + v.status | translate }}</span></td>
          <td class="act"><ng-container *ngIf="canManage"><button class="ghost sm" (click)="openVac(v)"><app-icon name="edit" [size]="15"></app-icon></button>
            <button class="ghost sm danger-i" (click)="removeVac(v)"><app-icon name="trash" [size]="15"></app-icon></button></ng-container></td>
        </tr></tbody></table></div>
      <div class="empty" *ngIf="!vacancies().length">{{ 'common.noData' | translate }}</div>
    </div>

    <!-- vacancy dialog -->
    <div class="modal-scrim" *ngIf="vacForm" (click)="vacForm = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'hr.rc.newVacancy' | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'hr.org.code' | translate }} *</label><input [(ngModel)]="vacForm.code" /></div>
          <div><label class="lbl">{{ 'hr.f.status' | translate }}</label><select [(ngModel)]="vacForm.status"><option *ngFor="let s of vStatuses" [value]="s">{{ 'hr.rc.vs.' + s | translate }}</option></select></div>
          <div class="full"><label class="lbl">{{ 'hr.rc.title' | translate }} *</label><input [(ngModel)]="vacForm.title" /></div>
          <div><label class="lbl">{{ 'hr.f.unit' | translate }}</label><input [(ngModel)]="vacForm.unit" list="rc-units" /></div>
          <div><label class="lbl">{{ 'hr.f.location' | translate }}</label><input [(ngModel)]="vacForm.location" /></div>
          <div><label class="lbl">{{ 'hr.rc.openings' | translate }}</label><input type="number" min="1" [(ngModel)]="vacForm.openings" /></div>
          <div><label class="lbl">{{ 'hr.f.grade' | translate }}</label><input [(ngModel)]="vacForm.grade" /></div>
        </div><datalist id="rc-units"><option *ngFor="let u of hr.ref('unit')" [value]="u.code || ''">{{ u.data['name'] }}</option></datalist>
        <p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="vacForm = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="saveVac()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <!-- candidate dialog -->
    <div class="modal-scrim" *ngIf="candForm" (click)="candForm = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'hr.rc.newCandidate' | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div class="full"><label class="lbl">{{ 'hr.f.fullName' | translate }} *</label><input [(ngModel)]="candForm.name" /></div>
          <div><label class="lbl">{{ 'hr.f.email' | translate }}</label><input type="email" [(ngModel)]="candForm.email" /></div>
          <div><label class="lbl">{{ 'hr.f.phone' | translate }}</label><input [(ngModel)]="candForm.phone" dir="ltr" /></div>
          <div class="full"><label class="lbl">{{ 'hr.rc.vacancy' | translate }}</label>
            <select [(ngModel)]="candForm.vacancy"><option value="">—</option><option *ngFor="let v of vacancies()" [value]="v.code">{{ v.code }} · {{ v.data['title'] }}</option></select></div>
          <div><label class="lbl">{{ 'hr.rc.source' | translate }}</label><input [(ngModel)]="candForm.source" /></div>
          <div><label class="lbl">{{ 'hr.rc.stage' | translate }}</label><select [(ngModel)]="candForm.stage"><option *ngFor="let s of stages" [value]="s">{{ 'hr.rc.st.' + s | translate }}</option></select></div>
          <div class="full"><label class="lbl">{{ 'hr.f.notes' | translate }}</label><input [(ngModel)]="candForm.notes" /></div>
        </div><p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="candForm = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="saveCand()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <app-employee-form *ngIf="hiring" [prefill]="prefill" [employees]="emps()" (closed)="hiring = null" (saved)="onHired()"></app-employee-form>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; } .grow { flex: 1; } .bar select { width: auto; }
    .board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(230px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 8px; }
    .lane { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 220px; }
    .lane-head { display: flex; justify-content: space-between; align-items: center; padding: 2px 4px 4px; font-size: 13px; }
    .cardc { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow); }
    .who { display: flex; gap: 8px; align-items: center; font-size: 13px; }
    .av { width: 30px; height: 30px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
    .acts { display: flex; gap: 4px; flex-wrap: wrap; } .acts button { padding: 3px 8px; }
    .sm { font-size: 11.5px; } .empty-lane { text-align: center; margin: 14px 0; }
    .act { white-space: nowrap; text-align: end; } .danger-i { color: var(--bad); }
    .chip.ok { background: var(--ok-soft); color: var(--ok); }
  `]
})
export class HrRecruitmentComponent implements OnInit {
  stages = CANDIDATE_STAGES;
  vStatuses = ['Open', 'OnHold', 'Closed'];
  tab = signal<'pipeline' | 'vacancies'>('pipeline');
  vac = signal('');
  vacancies = signal<HrRecord[]>([]);
  candidates = signal<HrRecord[]>([]);
  emps = signal<Employee[]>([]);
  vacForm: any = null; candForm: any = null; editId = '';
  hiring: HrRecord | null = null; prefill: Partial<Employee> = {};
  saving = false; formError = ''; flashMsg = ''; flashBad = false;

  canManage = this.auth.can('hr.recruitment.manage');
  shownCands = computed(() => this.candidates().filter(c => !this.vac() || c.data['vacancy'] === this.vac()));

  constructor(public auth: AuthService, public hr: HrService, private i18n: I18nService) {}

  ngOnInit() { this.load(); this.hr.loadRefs(['unit']).subscribe(); this.hr.employees().subscribe({ next: l => this.emps.set(l), error: () => {} }); }
  load() {
    this.hr.records('vacancy').subscribe({ next: l => this.vacancies.set(l), error: e => this.flash(errMsg(e, this.i18n), true) });
    this.hr.records('candidate').subscribe({ next: l => this.candidates.set(l), error: () => {} });
  }

  ini(n: string) { return initials(n); }
  idx(s: string) { return (this.stages as readonly string[]).indexOf(s); }
  byStage(s: string) { return this.shownCands().filter(c => (c.status ?? 'Applied') === s); }
  vacTitle(code: string) { return this.vacancies().find(v => v.code === code)?.data['title'] ?? ''; }
  candCount(code: string | null | undefined) { return this.candidates().filter(c => c.data['vacancy'] === code).length; }

  move(c: HrRecord, to: number) {
    this.hr.updateRecord('candidate', c.id, { status: this.stages[to], data: c.data }).subscribe({ next: () => this.load(), error: e => this.flash(errMsg(e, this.i18n), true) });
  }

  hire(c: HrRecord) {
    const v = this.vacancies().find(x => x.code === c.data['vacancy']);
    this.hiring = c;
    this.prefill = { fullName: c.data['name'], email: c.data['email'], phone: c.data['phone'], position: v?.data['title'], unit: v?.data['unit'], location: v?.data['location'], grade: v?.data['grade'], hireDate: todayStr(), status: 'Probation' as any };
  }
  onHired() {
    const c = this.hiring!; this.hiring = null;
    this.hr.updateRecord('candidate', c.id, { status: 'Hired', data: c.data }).subscribe(() => { this.flash(this.i18n.t('hr.rc.hired')); this.load(); });
  }

  openVac(v: HrRecord | null) { this.formError = ''; this.editId = v?.id ?? ''; this.vacForm = v ? { code: v.code, status: v.status, ...v.data } : { code: 'VAC-' + String(this.vacancies().length + 1).padStart(3, '0'), status: 'Open', title: '', unit: '', location: '', openings: 1, grade: '' }; }
  saveVac() {
    const { code, status, ...data } = this.vacForm;
    if (!String(code ?? '').trim() || !String(data.title ?? '').trim()) { this.formError = this.i18n.t('hr.err.required'); return; }
    this.persist('vacancy', { code: code.trim(), status, data }, () => this.vacForm = null);
  }
  removeVac(v: HrRecord) { this.hr.deleteRecord('vacancy', v.id).subscribe({ next: () => this.load(), error: e => this.flash(errMsg(e, this.i18n), true) }); }

  openCand(c: HrRecord | null) { this.formError = ''; this.editId = c?.id ?? ''; this.candForm = c ? { ...c.data, stage: c.status } : { name: '', email: '', phone: '', vacancy: this.vac(), source: '', notes: '', stage: 'Applied' }; }
  saveCand() {
    const { stage, ...data } = this.candForm;
    if (!String(data.name ?? '').trim()) { this.formError = this.i18n.t('hr.err.required'); return; }
    this.persist('candidate', { status: stage, data }, () => this.candForm = null);
  }
  removeCand(c: HrRecord) { this.hr.deleteRecord('candidate', c.id).subscribe({ next: () => this.load(), error: e => this.flash(errMsg(e, this.i18n), true) }); }

  private persist(kind: 'vacancy' | 'candidate', body: Partial<HrRecord>, done: () => void) {
    this.saving = true; this.formError = '';
    (this.editId ? this.hr.updateRecord(kind, this.editId, body) : this.hr.createRecord(kind, body)).subscribe({
      next: () => { this.saving = false; done(); this.flash(this.i18n.t('hr.saved')); this.load(); },
      error: e => { this.saving = false; this.formError = e.status === 409 ? this.i18n.t('hr.err.dupCode') : errMsg(e, this.i18n); }
    });
  }
  private flash(m: string, bad = false) { this.flashMsg = m; this.flashBad = bad; setTimeout(() => this.flashMsg = '', 3500); }
}
