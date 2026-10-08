import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { lastValueFrom } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { Employee, ImportResult } from '../core/hr.models';
import { EMP_FIELDS, MappedRow, guessField, mapRows, parseCsv } from '../core/hr.fields';
import { IconComponent } from '../shared/ui';
import { errMsg } from './hr-util';

type Step = 'pick' | 'map' | 'done';
const CHUNK = 200;

/**
 * Bulk-add employees from an Excel (.xlsx) or CSV file:
 *   1. choose the file (or download the template)   2. check how the columns map to employee fields, preview, validate   3. import
 * Rows with an existing employee number are updated (or skipped, your choice). Files are read in the browser; only the mapped rows are sent.
 */
@Component({
  selector: 'app-employee-import',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="modal-scrim" (click)="close()">
      <div class="modal wide" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'hr.imp.title' | translate }}</h3>
          <button class="ghost icon-btn" (click)="close()"><app-icon name="x"></app-icon></button></div>

        <div class="modal-body">
          <!-- 1 pick -->
          <ng-container *ngIf="step() === 'pick'">
            <p class="dim">{{ 'hr.imp.intro' | translate }}</p>
            <label class="drop" [class.over]="over" (dragover)="$event.preventDefault(); over = true" (dragleave)="over = false" (drop)="onDrop($event)">
              <app-icon name="import" [size]="26"></app-icon>
              <strong>{{ 'hr.imp.drop' | translate }}</strong>
              <span class="dim">.xlsx · .csv</span>
              <input type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="onFile($event)" hidden />
            </label>
            <div class="row"><button (click)="template()"><app-icon name="download" [size]="15"></app-icon>{{ 'hr.imp.template' | translate }}</button>
              <span class="hint">{{ 'hr.imp.templateHint' | translate }}</span></div>
            <p class="flash bad" *ngIf="error">{{ error }}</p>
            <p class="dim" *ngIf="busy">{{ 'hr.imp.reading' | translate }}</p>
          </ng-container>

          <!-- 2 map -->
          <ng-container *ngIf="step() === 'map'">
            <p class="dim"><strong>{{ fileName }}</strong> · {{ 'hr.imp.rows' | translate: { n: dataRows } }}</p>
            <label class="chk"><input type="checkbox" [(ngModel)]="hasHeader" (ngModelChange)="remap()" /> {{ 'hr.imp.hasHeader' | translate }}</label>

            <h4 class="sec">{{ 'hr.imp.mapping' | translate }}</h4>
            <div class="map">
              <div class="m" *ngFor="let h of headers; let i = index">
                <span class="col" [title]="h">{{ h || ('hr.imp.column' | translate) + ' ' + (i + 1) }}</span>
                <span class="arr">→</span>
                <select [ngModel]="mapping[i] || ''" (ngModelChange)="setMap(i, $event)">
                  <option value="">{{ 'hr.imp.skip' | translate }}</option>
                  <option *ngFor="let f of fields" [value]="f.key">{{ f.label | translate }}{{ f.required ? ' *' : '' }}</option>
                </select>
              </div>
            </div>
            <p class="flash bad" *ngIf="missingRequired().length">{{ 'hr.imp.needMap' | translate }}: {{ missingRequired().join(', ') }}</p>

            <h4 class="sec">{{ 'hr.imp.preview' | translate }}
              <span class="chip ok">{{ 'hr.imp.valid' | translate: { n: validCount() } }}</span>
              <span class="chip high" *ngIf="invalidCount()">{{ 'hr.imp.invalid' | translate: { n: invalidCount() } }}</span></h4>
            <div class="table-wrap prev">
              <table class="data">
                <thead><tr><th>#</th><th *ngFor="let f of mappedFields()">{{ f.label | translate }}</th><th></th></tr></thead>
                <tbody>
                  <tr *ngFor="let m of previewRows()" [class.bad]="m.errors.length">
                    <td class="dim">{{ m.row }}</td>
                    <td *ngFor="let f of mappedFields()" [class.cell-bad]="hasErr(m, f.key)">{{ m.data[f.key] ?? '' }}</td>
                    <td><span class="chip high" *ngIf="m.errors.length" [title]="errText(m)">{{ errText(m) }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="hint" *ngIf="mapped.length > previewRows().length">{{ 'hr.imp.more' | translate: { n: mapped.length - previewRows().length } }}</p>

            <label class="chk"><input type="checkbox" [(ngModel)]="updateExisting" /> {{ 'hr.imp.update' | translate }}</label>
            <div class="progress" *ngIf="busy"><div [style.width.%]="progress"></div></div>
            <p class="flash bad" *ngIf="error">{{ error }}</p>
          </ng-container>

          <!-- 3 done -->
          <ng-container *ngIf="step() === 'done' && result as r">
            <div class="done">
              <app-icon name="check" [size]="30"></app-icon>
              <h3>{{ 'hr.imp.done' | translate }}</h3>
              <div class="stats">
                <div><b>{{ r.created }}</b><span>{{ 'hr.imp.created' | translate }}</span></div>
                <div><b>{{ r.updated }}</b><span>{{ 'hr.imp.updated' | translate }}</span></div>
                <div><b>{{ r.skipped }}</b><span>{{ 'hr.imp.skipped' | translate }}</span></div>
                <div [class.badn]="r.errors.length"><b>{{ r.errors.length }}</b><span>{{ 'hr.imp.failed' | translate }}</span></div>
              </div>
            </div>
            <ng-container *ngIf="r.errors.length">
              <h4 class="sec">{{ 'hr.imp.errors' | translate }}</h4>
              <div class="table-wrap prev"><table class="data"><thead><tr><th>#</th><th>{{ 'hr.f.empNo' | translate }}</th><th>{{ 'hr.imp.reason' | translate }}</th></tr></thead>
                <tbody><tr *ngFor="let e of r.errors"><td class="dim">{{ e.row }}</td><td class="mono">{{ e.empNo }}</td><td>{{ e.message }}</td></tr></tbody></table></div>
            </ng-container>
          </ng-container>
        </div>

        <div class="modal-foot">
          <button *ngIf="step() === 'map'" (click)="step.set('pick')" [disabled]="busy">{{ 'hr.imp.back' | translate }}</button>
          <button (click)="close()">{{ (step() === 'done' ? 'hr.imp.close' : 'common.cancel') | translate }}</button>
          <button class="primary" *ngIf="step() === 'map'" (click)="run()" [disabled]="busy || !validCount() || missingRequired().length > 0">
            {{ 'hr.imp.run' | translate: { n: validCount() } }}</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal.wide { width: min(980px, 100%); }
    .drop { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 34px 16px; border: 2px dashed var(--border-strong); border-radius: var(--radius); cursor: pointer; text-align: center; color: var(--text-2); margin: 12px 0; }
    .drop:hover, .drop.over { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
    .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .sec { margin: 18px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); display: flex; gap: 8px; align-items: center; }
    :host-context(html[dir="rtl"]) .sec { text-transform: none; letter-spacing: 0; }
    .chk { display: flex; gap: 8px; align-items: center; margin: 10px 0; font-size: 13px; cursor: pointer; }
    .map { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px 14px; }
    .m { display: grid; grid-template-columns: minmax(80px, 1fr) 16px minmax(130px, 1.2fr); align-items: center; gap: 6px; }
    .col { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--surface-3); padding: 7px 10px; border-radius: var(--radius-sm); font-size: 12.5px; }
    .arr { text-align: center; color: var(--text-dim); }
    :host-context(html[dir="rtl"]) .arr { transform: scaleX(-1); }
    .prev { max-height: 260px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .prev table th, .prev table td { padding: 6px 10px; white-space: nowrap; }
    tr.bad td { background: var(--bad-soft); }
    td.cell-bad { color: var(--bad); font-weight: 600; }
    .chip.ok { background: var(--ok-soft); color: var(--ok); text-transform: none; letter-spacing: 0; }
    .chip.high { text-transform: none; letter-spacing: 0; }
    .progress { height: 6px; background: var(--surface-3); border-radius: 4px; overflow: hidden; margin-top: 12px; }
    .progress div { height: 100%; background: var(--primary); transition: width .2s; }
    .done { text-align: center; color: var(--ok); padding: 8px 0 4px; }
    .done h3 { color: var(--text); margin: 6px 0 14px; }
    .stats { display: flex; justify-content: center; gap: 28px; flex-wrap: wrap; }
    .stats div { display: flex; flex-direction: column; align-items: center; color: var(--text-2); font-size: 12px; }
    .stats b { font-size: 24px; color: var(--text); }
    .stats .badn b { color: var(--bad); }
  `]
})
export class EmployeeImportComponent {
  @Input() existing: Employee[] = [];
  @Output() finished = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  fields = EMP_FIELDS.filter(f => !f.salary || this.auth.can('hr.employees.salary'));
  step = signal<Step>('pick');
  over = false;
  busy = false;
  progress = 0;
  error = '';
  fileName = '';
  rows: unknown[][] = [];
  headers: string[] = [];
  mapping: Record<number, keyof Employee | ''> = {};
  hasHeader = true;
  mapped: MappedRow[] = [];
  updateExisting = true;
  result: ImportResult | null = null;
  dataRows = 0;

  constructor(private auth: AuthService, private hr: HrService, private i18n: I18nService) {}

  close() { this.closed.emit(); }
  onDrop(e: DragEvent) { e.preventDefault(); this.over = false; const f = e.dataTransfer?.files?.[0]; if (f) this.read(f); }
  onFile(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.read(f); }

  async read(file: File) {
    this.error = ''; this.busy = true; this.fileName = file.name;
    try {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'xlsx') {
        const { default: readXlsxFile } = await import('read-excel-file');
        this.rows = (await readXlsxFile(file)) as unknown[][];
      } else if (ext === 'csv' || ext === 'txt') {
        this.rows = parseCsv(await file.text());
      } else { this.error = this.i18n.t('hr.imp.badType'); this.busy = false; return; }
      this.rows = this.rows.filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ''));
      if (this.rows.length < 1) { this.error = this.i18n.t('hr.imp.empty'); this.busy = false; return; }
      if (this.rows.length > 5000) { this.error = this.i18n.t('hr.imp.tooMany'); this.busy = false; return; }
      this.hasHeader = true;
      this.autoMap();
      this.step.set('map');
    } catch {
      this.error = this.i18n.t('hr.imp.readError');
    }
    this.busy = false;
  }

  /** Header row -> best-guess mapping (each field used once). If nothing matches, the first row is data and columns map in template order. */
  private autoMap() {
    const width = Math.max(...this.rows.map(r => r.length));
    const first = this.rows[0] ?? [];
    this.mapping = {};
    const used = new Set<string>();
    for (let c = 0; c < width; c++) {
      const g = guessField(first[c]);
      if (g && !used.has(g)) { this.mapping[c] = g; used.add(g); }
    }
    this.hasHeader = Object.keys(this.mapping).length >= 2 || !!this.mapping[0];
    this.refreshHeaders(width);
    this.remap();
  }

  private refreshHeaders(width = Math.max(...this.rows.map(r => r.length))) {
    this.headers = Array.from({ length: width }, (_, c) => this.hasHeader ? String(this.rows[0]?.[c] ?? '').trim() : '');
  }

  remap() { this.refreshHeaders(); this.compute(); }
  setMap(col: number, field: string) {
    if (field) for (const k of Object.keys(this.mapping)) if (this.mapping[+k] === field && +k !== col) this.mapping[+k] = '';
    this.mapping[col] = field as keyof Employee | '';
    this.compute();
  }

  private compute() {
    this.mapped = mapRows(this.rows, this.mapping, this.hasHeader ? 1 : 0, this.auth.can('hr.employees.salary'));
    this.dataRows = this.mapped.length;
    const known = new Set(this.existing.map(e => e.empNo.toLowerCase()));
    const seen = new Set<string>();
    for (const m of this.mapped) {
      const no = String(m.data.empNo ?? '').toLowerCase();
      if (no && seen.has(no)) m.errors.push('empNo:dup');
      if (no) seen.add(no);
      m.warnings = known.has(no) ? ['update'] : [];
    }
  }

  missingRequired(): string[] {
    const mappedKeys = new Set(Object.values(this.mapping).filter(Boolean));
    return EMP_FIELDS.filter(f => f.required && !mappedKeys.has(f.key)).map(f => this.i18n.t(f.label));
  }
  mappedFields() { const keys = new Set(Object.values(this.mapping).filter(Boolean)); return EMP_FIELDS.filter(f => keys.has(f.key)); }
  previewRows() { return this.mapped.slice(0, 50); }
  validCount() { return this.mapped.filter(m => !m.errors.length).length; }
  invalidCount() { return this.mapped.filter(m => m.errors.length).length; }
  hasErr(m: MappedRow, key: string) { return m.errors.some(e => e.split(':')[0] === key); }
  errText(m: MappedRow) {
    return m.errors.map(e => {
      const [k, why] = e.split(':');
      const f = EMP_FIELDS.find(x => x.key === k);
      const label = f ? this.i18n.t(f.label) : k;
      return why ? `${label}: ${this.i18n.t('hr.imp.e.' + why)}` : `${label}: ${this.i18n.t('hr.imp.e.required')}`;
    }).join(' · ');
  }

  async run() {
    this.busy = true; this.error = ''; this.progress = 0;
    const good = this.mapped.filter(m => !m.errors.length).map(m => ({ row: m.row, data: m.data }));
    const total: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    try {
      for (let i = 0; i < good.length; i += CHUNK) {
        const r = await lastValueFrom(this.hr.importEmployees(good.slice(i, i + CHUNK), this.updateExisting));
        total.created += r.created; total.updated += r.updated; total.skipped += r.skipped; total.errors.push(...r.errors);
        this.progress = Math.round(Math.min(good.length, i + CHUNK) / good.length * 100);
      }
      // rows rejected in the browser are reported too
      for (const m of this.mapped.filter(x => x.errors.length)) total.errors.push({ row: m.row, empNo: String(m.data.empNo ?? ''), message: this.errText(m) });
      this.result = total;
      this.step.set('done');
      this.finished.emit();
    } catch (e) {
      this.error = errMsg(e, this.i18n);
    }
    this.busy = false;
  }

  /** Downloads an .xlsx with the right headings and one sample row. */
  async template() {
    const { default: writeXlsxFile } = await import('write-excel-file');
    const fs = this.fields;
    // plain field names as headings: they map automatically, in any UI language
    const head = fs.map(f => ({ value: String(f.key), fontWeight: 'bold' as const }));
    const sample = fs.map(f => ({ value: f.sample === '' ? null : f.sample, type: typeof f.sample === 'number' ? Number : String }));
    await writeXlsxFile([head, sample] as any, { fileName: 'employees-template.xlsx', columns: fs.map(() => ({ width: 20 })) } as any);
  }
}
