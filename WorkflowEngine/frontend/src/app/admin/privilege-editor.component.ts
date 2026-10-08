import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PermissionCatalog } from '../core/models';
import { TranslatePipe } from '../core/translate.pipe';

/** Grouped checkboxes for a user's privileges, with "use role defaults", copy-from-role and select/clear all. */
@Component({
  selector: 'app-privilege-editor',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <label class="defaults">
      <input type="checkbox" [checked]="useDefaults" (change)="toggleDefaults($any($event.target).checked)" />
      <span><strong>{{ 'admin.useRoleDefaults' | translate }}</strong><small>{{ 'admin.roleNote' | translate }}</small></span>
    </label>

    <div class="tools" *ngIf="!useDefaults">
      <button type="button" class="sm" (click)="all()">{{ 'admin.selectAll' | translate }}</button>
      <button type="button" class="sm" (click)="none()">{{ 'admin.clearAll' | translate }}</button>
      <button type="button" class="sm" (click)="copyRole()">{{ 'admin.copyRole' | translate }}: {{ role }}</button>
    </div>

    <div class="groups" [class.off]="useDefaults">
      <div class="group" *ngFor="let g of catalog.groups">
        <h5>{{ 'perm.group.' + g.group | translate }}</h5>
        <label *ngFor="let k of g.keys" [class.on]="has(k)">
          <input type="checkbox" [checked]="has(k)" [disabled]="useDefaults" (change)="flip(k, $any($event.target).checked)" />
          <span>{{ 'perm.' + k | translate }}</span>
        </label>
      </div>
    </div>
    <p class="hint" *ngIf="!useDefaults">{{ 'admin.privNote' | translate }}</p>
  `,
  styles: [`
    .defaults { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); cursor: pointer; }
    .defaults span { display: flex; flex-direction: column; gap: 2px; }
    .defaults small { color: var(--text-dim); font-size: 11.5px; }
    .defaults input { margin-top: 3px; }
    .tools { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0 4px; }
    .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-top: 12px; }
    .groups.off { opacity: .55; pointer-events: none; }
    .group { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; }
    h5 { margin: 0 0 6px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
    :host-context(html[dir="rtl"]) h5 { text-transform: none; letter-spacing: 0; }
    .group label { display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 13px; cursor: pointer; }
    .group label.on span { color: var(--text); font-weight: 550; }
    .group label span { color: var(--text-2); }
  `]
})
export class PrivilegeEditorComponent {
  @Input({ required: true }) catalog!: PermissionCatalog;
  @Input() role = 'employee';
  /** null = role defaults */
  @Input() value: string[] | null = null;
  @Output() valueChange = new EventEmitter<string[] | null>();

  get useDefaults() { return this.value === null; }
  private roleList(): string[] { return this.catalog.roleDefaults[this.role] ?? this.catalog.roleDefaults['employee'] ?? []; }
  /** what is shown ticked: the role's defaults while "use defaults" is on */
  has(k: string) { return (this.value ?? this.roleList()).includes(k); }

  toggleDefaults(on: boolean) { this.valueChange.emit(on ? null : [...this.roleList()]); }
  flip(k: string, on: boolean) {
    const cur = new Set(this.value ?? this.roleList());
    on ? cur.add(k) : cur.delete(k);
    this.valueChange.emit([...cur]);
  }
  all() { this.valueChange.emit(this.catalog.groups.flatMap(g => g.keys)); }
  none() { this.valueChange.emit([]); }
  copyRole() { this.valueChange.emit([...this.roleList()]); }
}
