import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PortalApiService } from '../core/portal-api.service';
import { PermissionCatalog } from '../core/models';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';

/** Read-only matrix of what each role gets by default (users without a custom list follow this). */
@Component({
  selector: 'app-admin-roles',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent],
  template: `
    <p class="dim lead">{{ 'admin.rolesSub' | translate }}</p>
    <div class="card" *ngIf="cat() as c">
      <div class="table-wrap">
        <table class="data matrix">
          <thead><tr><th>{{ 'admin.privileges' | translate }}</th><th class="c" *ngFor="let r of roleNames(c)">{{ r }}</th></tr></thead>
          <tbody>
            <ng-container *ngFor="let g of c.groups">
              <tr class="grp"><td [attr.colspan]="roleNames(c).length + 1">{{ 'perm.group.' + g.group | translate }}</td></tr>
              <tr *ngFor="let k of g.keys">
                <td>{{ 'perm.' + k | translate }} <span class="mono dim">{{ k }}</span></td>
                <td class="c" *ngFor="let r of roleNames(c)"><app-icon *ngIf="c.roleDefaults[r]?.includes(k)" name="check" [size]="15" class="ok"></app-icon></td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .lead { margin: 0 0 14px; font-size: 13px; }
    .matrix th.c, .matrix td.c { text-align: center; }
    .matrix td.c { width: 78px; }
    tr.grp td { background: var(--surface-3); font-weight: 650; font-size: 12px; color: var(--text-2); padding-block: 6px; }
    .ok { color: var(--ok); }
  `]
})
export class AdminRolesComponent implements OnInit {
  cat = signal<PermissionCatalog | null>(null);
  constructor(private api: PortalApiService) {}
  ngOnInit() { this.api.getPermissionCatalog().subscribe(c => this.cat.set(c)); }
  roleNames(c: PermissionCatalog) { return Object.keys(c.roleDefaults); }
}
