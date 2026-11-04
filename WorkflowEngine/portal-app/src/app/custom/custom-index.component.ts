import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { CustomService } from './custom.service';
import { CustomDesignerComponent } from './custom-designer.component';

@Component({
  selector: 'app-custom-index',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IconComponent, CustomDesignerComponent],
  template: `
    <div class="page-head"><div class="titles"><h1>{{ 'module.custom' | translate }}</h1><p>{{ 'cus.indexSub' | translate }}</p></div>
      <button class="primary" *ngIf="auth.can('cus.design')" (click)="dlg.set(true)"><app-icon name="plus" [size]="15"></app-icon> {{ 'cus.newModule' | translate }}</button></div>
    <div class="cards">
      <a class="card mc" *ngFor="let m of svc.modules()" [routerLink]="['/custom', m.key]"><i [style.background]="m.def.color"><app-icon [name]="m.def.icon" [size]="20"></app-icon></i><b>{{ svc.title(m) }}</b><small>{{ m.def.fields.length }} {{ 'cus.fields' | translate }}</small></a>
      <p class="dim" *ngIf="svc.loaded() && !svc.modules().length">{{ 'cus.empty' | translate }}</p>
    </div>
    <app-custom-designer *ngIf="dlg()" (closed)="dlg.set(false)" (saved)="dlg.set(false); open($event.key)"></app-custom-designer>`,
  styles: [`.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; } .mc { display: flex; flex-direction: column; gap: 6px; padding: 18px; color: var(--text); } .mc i { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; color: #fff; } .mc small, .dim { color: var(--text-dim); } .page-head { display: flex; justify-content: space-between; align-items: center; }`]
})
export class CustomIndexComponent implements OnInit {
  auth = inject(AuthService); svc = inject(CustomService); private router = inject(Router); dlg = signal(false);
  ngOnInit() { this.svc.load().subscribe({ error: () => {} }); }
  open(k: string) { void this.router.navigate(['/custom', k]); }
}
