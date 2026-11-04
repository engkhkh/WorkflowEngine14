import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonIcon, IonFooter, IonModal, IonList, IonItem, IonLabel,
  IonInput, IonTextarea, IonSelect, IonSelectOption, IonToggle, IonListHeader, IonNote, IonSegment, IonSegmentButton, IonBadge, AlertController, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { saveOutline, cloudUploadOutline, playOutline, addCircleOutline, linkOutline, trashOutline, optionsOutline, closeOutline, gitCommitOutline } from 'ionicons/icons';
import { WorkflowService } from './workflow.service';
import { AuthService } from '../core/auth.service';
import { NODE_PALETTE, NODE_CATEGORIES, NodeCategory, NodeType, User, WorkflowDefinition, WorkflowEdge, WorkflowNode, ConditionEvalResult } from './workflow.models';
import { WF_PROPS, WF_COMMON, WfProp } from './workflow.spec';
import { WfFormEditorComponent } from './form-editor.component';

/**
 * Touch workflow designer - same model as the portal designer: 22 node types in 7 categories, drag nodes,
 * link mode for edges (auto Approve/Reject, True/False labels), per-type property editor, form builder,
 * condition tester, save / publish / test-run.
 */
@Component({
  selector: 'app-wf-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, WfFormEditorComponent, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonIcon,
    IonFooter, IonModal, IonList, IonItem, IonLabel, IonInput, IonTextarea, IonSelect, IonSelectOption, IonToggle, IonListHeader, IonNote, IonSegment, IonSegmentButton, IonBadge],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/workflow"></ion-back-button></ion-buttons>
      <ion-title>{{ def.name || 'Workflow' }} <ion-badge [color]="def.isPublished ? 'success' : 'medium'">{{ def.isPublished ? 'v' + def.version : 'draft' }}</ion-badge></ion-title>
      <ion-buttons slot="end">
        <ion-button (click)="meta = true" [disabled]="readonly"><ion-icon name="options-outline" slot="icon-only"></ion-icon></ion-button>
        <ion-button (click)="save()" [disabled]="readonly"><ion-icon name="save-outline" slot="icon-only"></ion-icon></ion-button>
        <ion-button (click)="publish()" *ngIf="auth.can('wf.publish')" [disabled]="def.isPublished || !def.id"><ion-icon name="cloud-upload-outline" slot="icon-only"></ion-icon></ion-button>
        <ion-button (click)="run()" [disabled]="!def.isPublished"><ion-icon name="play-outline" slot="icon-only"></ion-icon></ion-button>
      </ion-buttons>
    </ion-toolbar></ion-header>

    <ion-content [scrollX]="true" [scrollY]="true" #scroller>
      <div class="hint" *ngIf="linkMode">Link mode: tap the source step, then the target step.{{ linkFrom ? ' Source: ' + nodeName(linkFrom) : '' }}</div>
      <svg #svg [attr.width]="W" [attr.height]="H" class="cv" (pointermove)="move($event)" (pointerup)="up()" (pointercancel)="up()" (pointerleave)="up()" (click)="clearSel($event)">
        <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8a94a6"/></marker></defs>
        <g *ngFor="let e of def.edges" (click)="selectEdge(e, $event)">
          <path [attr.d]="edgePath(e)" class="edge" [class.sel]="e.id === selEdge" marker-end="url(#ar)"/>
          <path [attr.d]="edgePath(e)" class="hit"/>
          <text [attr.x]="mid(e).x" [attr.y]="mid(e).y - 4" class="elabel">{{ e.label }}</text>
        </g>
        <g *ngFor="let n of def.nodes" [attr.transform]="'translate(' + n.x + ',' + n.y + ')'" class="node" [class.sel]="n.id === selNode" [class.src]="n.id === linkFrom"
           (pointerdown)="down($event, n)" (click)="tapNode(n, $event)">
          <ng-container [ngSwitch]="shape(n.type)">
            <circle *ngSwitchCase="'circle'" cx="30" cy="30" r="30" class="box" [style.stroke]="color(n.type)"/>
            <path *ngSwitchCase="'diamond'" d="M70 0L140 40L70 80L0 40Z" class="box" [style.stroke]="color(n.type)"/>
            <rect *ngSwitchDefault width="140" height="60" rx="10" class="box" [style.stroke]="color(n.type)"/>
          </ng-container>
          <text [attr.x]="cx(n)" [attr.y]="n.type === 'Start' || n.type === 'End' ? 35 : 24" class="ico" text-anchor="middle">{{ icon(n.type) }}</text>
          <text *ngIf="shape(n.type) !== 'circle'" [attr.x]="cx(n)" [attr.y]="shape(n.type) === 'diamond' ? 52 : 44" class="nm" text-anchor="middle">{{ short(n.name) }}</text>
        </g>
      </svg>
    </ion-content>

    <ion-footer><ion-toolbar>
      <ion-buttons>
        <ion-button (click)="palette = true" [disabled]="readonly"><ion-icon name="add-circle-outline" slot="start"></ion-icon>Step</ion-button>
        <ion-button (click)="toggleLink()" [color]="linkMode ? 'warning' : 'primary'" [disabled]="readonly"><ion-icon name="link-outline" slot="start"></ion-icon>Link</ion-button>
        <ion-button (click)="props = true" [disabled]="!selNode && !selEdge"><ion-icon name="git-commit-outline" slot="start"></ion-icon>Edit</ion-button>
        <ion-button color="danger" (click)="del()" [disabled]="(!selNode && !selEdge) || readonly"><ion-icon name="trash-outline" slot="start"></ion-icon>Delete</ion-button>
      </ion-buttons>
    </ion-toolbar></ion-footer>

    <!-- palette -->
    <ion-modal [isOpen]="palette" (didDismiss)="palette = false" [initialBreakpoint]="0.7" [breakpoints]="[0, 0.7, 1]">
      <ng-template>
        <ion-header><ion-toolbar><ion-title>Add a step</ion-title></ion-toolbar></ion-header>
        <ion-content>
          <ion-list *ngFor="let c of categories">
            <ion-list-header>{{ c }}</ion-list-header>
            <ion-item button *ngFor="let p of inCat(c)" (click)="add(p.type)">
              <span slot="start" class="pi" [style.background]="p.color">{{ p.icon }}</span>
              <ion-label>{{ p.label }}<p>{{ p.note }}</p></ion-label>
            </ion-item>
          </ion-list>
        </ion-content>
      </ng-template>
    </ion-modal>

    <!-- workflow name / description -->
    <ion-modal [isOpen]="meta" (didDismiss)="meta = false" [initialBreakpoint]="0.45" [breakpoints]="[0, 0.45]">
      <ng-template><ion-content class="ion-padding">
        <ion-input label="Workflow name" labelPlacement="stacked" [(ngModel)]="def.name"></ion-input>
        <ion-textarea label="Description" labelPlacement="stacked" [(ngModel)]="def.description" rows="3"></ion-textarea>
        <ion-button expand="block" (click)="meta = false">Done</ion-button>
      </ion-content></ng-template>
    </ion-modal>

    <!-- properties -->
    <ion-modal [isOpen]="props" (didDismiss)="props = false" [initialBreakpoint]="0.85" [breakpoints]="[0, 0.5, 0.85, 1]">
      <ng-template>
        <ion-header><ion-toolbar><ion-title>{{ node ? node.type + ' properties' : 'Edge' }}</ion-title>
          <ion-buttons slot="end"><ion-button (click)="props = false"><ion-icon name="close-outline" slot="icon-only"></ion-icon></ion-button></ion-buttons></ion-toolbar></ion-header>
        <ion-content class="ion-padding">
          <ng-container *ngIf="node as n">
            <ng-container *ngFor="let p of fieldsFor(n)">
              <ng-container *ngIf="visible(n, p)" [ngSwitch]="p.kind">
                <ion-input *ngSwitchCase="'text'" [label]="p.label" labelPlacement="stacked" [ngModel]="$any(n)[p.key]" (ngModelChange)="$any(n)[p.key] = $event"></ion-input>
                <ion-input *ngSwitchCase="'number'" type="number" [label]="p.label" labelPlacement="stacked" [ngModel]="$any(n)[p.key]" (ngModelChange)="$any(n)[p.key] = $event === '' || $event == null ? undefined : +$event"></ion-input>
                <ion-textarea *ngSwitchCase="'textarea'" [label]="p.label" labelPlacement="stacked" rows="4" [ngModel]="$any(n)[p.key]" (ngModelChange)="$any(n)[p.key] = $event"></ion-textarea>
                <ion-toggle *ngSwitchCase="'bool'" [checked]="!!$any(n)[p.key]" (ionChange)="$any(n)[p.key] = $any($event).detail.checked">{{ p.label }}</ion-toggle>
                <ion-select *ngSwitchCase="'select'" [label]="p.label" labelPlacement="stacked" interface="action-sheet" [value]="$any(n)[p.key] ?? ''" (ionChange)="$any(n)[p.key] = $any($event).detail.value">
                  <ion-select-option *ngFor="let o of p.options" [value]="o">{{ o || '— none (stub) —' }}</ion-select-option>
                </ion-select>
                <ion-select *ngSwitchCase="'assignees'" [label]="p.label" labelPlacement="stacked" [multiple]="true" [value]="assignees(n)" (ionChange)="n.assignee = $any($event).detail.value.join(',')">
                  <ion-select-option *ngFor="let r of roles" [value]="r">role: {{ r }}</ion-select-option>
                  <ion-select-option *ngFor="let u of users" [value]="u.username">{{ u.displayName }} ({{ u.username }})</ion-select-option>
                </ion-select>
                <ion-select *ngSwitchCase="'assignee1'" [label]="p.label" labelPlacement="stacked" [value]="$any(n)[p.key]" (ionChange)="$any(n)[p.key] = $any($event).detail.value">
                  <ion-select-option *ngFor="let r of roles" [value]="r">role: {{ r }}</ion-select-option>
                  <ion-select-option *ngFor="let u of users" [value]="u.username">{{ u.displayName }} ({{ u.username }})</ion-select-option>
                </ion-select>
                <ion-select *ngSwitchCase="'workflow'" [label]="p.label" labelPlacement="stacked" [value]="n.subWorkflowDefinitionId" (ionChange)="setSub(n, $any($event).detail.value)">
                  <ion-select-option *ngFor="let d of published" [value]="d.id">{{ d.name }}</ion-select-option>
                </ion-select>
                <app-wf-form-editor *ngSwitchCase="'form'" [form]="n.form"></app-wf-form-editor>
                <ion-note *ngIf="p.hint && p.kind !== 'form'" class="hn">{{ p.hint }}</ion-note>
                <div *ngIf="p.test === 'condition'" class="test">
                  <ion-textarea label="Sample data (JSON)" labelPlacement="stacked" rows="3" [(ngModel)]="testJson"></ion-textarea>
                  <ion-button size="small" (click)="testCond(n)">▶ Test</ion-button>
                  <p class="bad" *ngIf="testErr">{{ testErr }}</p>
                  <div *ngIf="testRes"><b [style.color]="testRes.result ? 'var(--ok)' : 'var(--bad)'">Result: {{ testRes.result ? 'True' : 'False' }}</b>
                    <div *ngFor="let c of testRes.clauses">{{ c.result ? '✓' : '✕' }} {{ c.clause }}</div></div>
                </div>
              </ng-container>
            </ng-container>
          </ng-container>
          <ng-container *ngIf="edge as e">
            <ion-select *ngIf="edgeSrcType(e) === 'Condition'" label="Label" labelPlacement="stacked" [value]="e.label" (ionChange)="e.label = $any($event).detail.value">
              <ion-select-option value="True">True</ion-select-option><ion-select-option value="False">False</ion-select-option></ion-select>
            <ion-input *ngIf="edgeSrcType(e) !== 'Condition'" label="Label" labelPlacement="stacked" [(ngModel)]="e.label"></ion-input>
            <ion-note *ngIf="edgeSrcType(e) === 'ApprovalTask'" class="hn">Becomes a button on the task (Approve, Reject or any custom outcome).</ion-note>
          </ng-container>
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styles: [`
    .cv { background: var(--surface-2); touch-action: pan-x pan-y; display: block; }
    .hint { position: sticky; left: 0; top: 0; z-index: 3; background: var(--ion-color-warning); color: #000; padding: 4px 10px; font-size: 12px; }
    .node { cursor: grab; touch-action: none; } .box { fill: var(--surface); stroke-width: 2; } .node.sel .box { stroke-width: 4; filter: drop-shadow(0 0 5px var(--primary)); }
    .node.src .box { stroke-dasharray: 6 3; } .nm { font-size: 11px; fill: var(--text); font-weight: 600; } .ico { font-size: 16px; fill: var(--text); }
    .edge { fill: none; stroke: #8a94a6; stroke-width: 2; } .edge.sel { stroke: var(--primary); stroke-width: 3; } .hit { fill: none; stroke: transparent; stroke-width: 18; }
    .elabel { font-size: 11px; fill: var(--text-dim); text-anchor: middle; paint-order: stroke; stroke: var(--surface-2); stroke-width: 3px; }
    .pi { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; font-size: 16px; color: #fff; }
    .hn { display: block; font-size: 11.5px; margin: 2px 0 10px; } .test { border: 1px dashed var(--border); border-radius: 8px; padding: 8px; margin: 8px 0; } .bad { color: var(--bad); }
  `]
})
export class WfDesignerPage implements OnInit {
  private route = inject(ActivatedRoute); private router = inject(Router); private wf = inject(WorkflowService); auth = inject(AuthService);
  private alerts = inject(AlertController); private toast = inject(ToastController);
  @ViewChild('svg') svg!: ElementRef<SVGSVGElement>;

  palList = NODE_PALETTE; categories = NODE_CATEGORIES;
  def: WorkflowDefinition = { id: '', name: 'Untitled flow', description: '', isPublished: false, version: 1, createdAt: '', updatedAt: '', nodes: [], edges: [] };
  users: User[] = []; roles: string[] = []; published: WorkflowDefinition[] = [];
  selNode: string | null = null; selEdge: string | null = null;
  palette = false; props = false; meta = false; linkMode = false; linkFrom: string | null = null;
  testJson = '{\n  \n}'; testRes: ConditionEvalResult | null = null; testErr = '';
  private drag: { id: string; dx: number; dy: number; moved: boolean } | null = null;

  constructor() { addIcons({ saveOutline, cloudUploadOutline, playOutline, addCircleOutline, linkOutline, trashOutline, optionsOutline, closeOutline, gitCommitOutline }); }

  get W() { return Math.max(900, ...this.def.nodes.map(n => n.x + 260)); }
  get H() { return Math.max(620, ...this.def.nodes.map(n => n.y + 200)); }
  get node(): WorkflowNode | undefined { return this.def.nodes.find(n => n.id === this.selNode); }
  get edge(): WorkflowEdge | undefined { return this.def.edges.find(e => e.id === this.selEdge); }
  /** a published template owned by another workspace is read-only (portal behaviour) - saving needs wf.design */
  get readonly() { return !this.auth.can('wf.design'); }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.wf.getDefinition(id).subscribe(d => { this.def = d; this.wf.getDefinitions().subscribe(all => this.published = all.filter(x => x.isPublished && x.id !== d.id)); });
    else this.wf.getDefinitions().subscribe(all => this.published = all.filter(x => x.isPublished));
    this.wf.getUsers().subscribe(u => { this.users = u; this.roles = [...new Set(u.map(x => x.role))].sort(); }, () => {});
  }

  inCat(c: NodeCategory) { return this.palList.filter(p => p.category === c); }
  color(t: NodeType) { return this.palList.find(p => p.type === t)?.color ?? '#888'; }
  icon(t: NodeType) { return this.palList.find(p => p.type === t)?.icon ?? '?'; }
  shape(t: NodeType): 'circle' | 'diamond' | 'rect' { return t === 'Start' || t === 'End' ? 'circle' : ['Condition', 'Switch', 'ParallelSplit', 'ParallelJoin'].includes(t) ? 'diamond' : 'rect'; }
  cx(n: WorkflowNode) { return this.shape(n.type) === 'circle' ? 30 : 70; }
  short(s: string) { return s.length > 17 ? s.slice(0, 16) + '…' : s; }
  nodeName(id: string) { return this.def.nodes.find(n => n.id === id)?.name ?? ''; }
  center(n: WorkflowNode) { const s = this.shape(n.type); return s === 'circle' ? { x: n.x + 30, y: n.y + 30 } : s === 'diamond' ? { x: n.x + 70, y: n.y + 40 } : { x: n.x + 70, y: n.y + 30 }; }
  edgePath(e: WorkflowEdge) {
    const a = this.def.nodes.find(n => n.id === e.sourceNodeId), b = this.def.nodes.find(n => n.id === e.targetNodeId); if (!a || !b) return '';
    const s = this.center(a), t = this.center(b), dx = (t.x - s.x) * .5; return `M ${s.x} ${s.y} C ${s.x + dx} ${s.y}, ${t.x - dx} ${t.y}, ${t.x} ${t.y}`;
  }
  mid(e: WorkflowEdge) {
    const a = this.def.nodes.find(n => n.id === e.sourceNodeId), b = this.def.nodes.find(n => n.id === e.targetNodeId); if (!a || !b) return { x: 0, y: 0 };
    const s = this.center(a), t = this.center(b); return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
  }
  edgeSrcType(e: WorkflowEdge) { return this.def.nodes.find(n => n.id === e.sourceNodeId)?.type; }

  // ---- property schema ----
  fieldsFor(n: WorkflowNode): WfProp[] { return [...WF_COMMON, ...(WF_PROPS[n.type] ?? [])]; }
  visible(n: WorkflowNode, p: WfProp) { if (!p.showIf) return true; const v = String((n as any)[p.showIf.key] ?? ''); return p.showIf.eq !== undefined ? v === p.showIf.eq : v !== p.showIf.ne; }
  assignees(n: WorkflowNode) { return (n.assignee || '').split(',').map(s => s.trim()).filter(Boolean); }
  setSub(n: WorkflowNode, id: string) { n.subWorkflowDefinitionId = id; n.subWorkflowDefinitionName = this.published.find(d => d.id === id)?.name; }

  // ---- canvas interaction ----
  private pt(ev: PointerEvent) {
    const s = this.svg.nativeElement, p = s.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    const m = s.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: ev.clientX, y: ev.clientY };
  }
  down(ev: PointerEvent, n: WorkflowNode) {
    if (this.linkMode || this.readonly) return;
    ev.stopPropagation(); (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
    const p = this.pt(ev); this.drag = { id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
  }
  move(ev: PointerEvent) {
    if (!this.drag) return; const n = this.def.nodes.find(x => x.id === this.drag!.id); if (!n) return;
    const p = this.pt(ev); n.x = Math.max(0, Math.round(p.x - this.drag.dx)); n.y = Math.max(0, Math.round(p.y - this.drag.dy)); this.drag.moved = true;
  }
  up() { setTimeout(() => this.drag = null, 0); }
  tapNode(n: WorkflowNode, ev: Event) {
    ev.stopPropagation(); if (this.drag?.moved) return;
    if (this.linkMode) { this.handleLink(n.id); return; }
    this.selNode = n.id; this.selEdge = null; this.testRes = null; this.testErr = '';
  }
  selectEdge(e: WorkflowEdge, ev: Event) { ev.stopPropagation(); this.selEdge = e.id; this.selNode = null; }
  clearSel(_: Event) { if (!this.linkMode) { this.selNode = null; this.selEdge = null; } }
  toggleLink() { this.linkMode = !this.linkMode; this.linkFrom = null; }
  handleLink(id: string) {
    if (!this.linkFrom) { this.linkFrom = id; return; }
    if (this.linkFrom === id) { this.linkFrom = null; return; }
    const src = this.def.nodes.find(n => n.id === this.linkFrom)!; let label = 'Default';
    if (src.type === 'ApprovalTask') label = this.def.edges.some(e => e.sourceNodeId === src.id && e.label === 'Approve') ? 'Reject' : 'Approve';
    else if (src.type === 'Condition') label = this.def.edges.some(e => e.sourceNodeId === src.id && e.label === 'True') ? 'False' : 'True';
    const e: WorkflowEdge = { id: crypto.randomUUID(), sourceNodeId: this.linkFrom, targetNodeId: id, label };
    this.def.edges.push(e); this.linkFrom = null; this.selEdge = e.id; this.selNode = null;
  }
  del() {
    if (this.selNode) { const id = this.selNode; this.def.nodes = this.def.nodes.filter(n => n.id !== id); this.def.edges = this.def.edges.filter(e => e.sourceNodeId !== id && e.targetNodeId !== id); this.selNode = null; }
    else if (this.selEdge) { this.def.edges = this.def.edges.filter(e => e.id !== this.selEdge); this.selEdge = null; }
  }

  add(type: NodeType) {
    const k = this.def.nodes.length, isTask = type === 'FormTask' || type === 'ApprovalTask';
    const n: WorkflowNode = { id: crypto.randomUUID(), type, name: this.palList.find(p => p.type === type)?.label ?? type, x: 40 + (k % 4) * 180, y: 40 + Math.floor(k / 4) * 110 };
    if (isTask) Object.assign(n, { assignee: '', priority: 'Normal', escalationMode: 'Reassign', form: { id: crypto.randomUUID(), title: n.name, fields: [] } });
    if (type === 'Timer') n.durationSeconds = 60;
    if (type === 'WebhookCall') n.webhookMethod = 'POST';
    if (type === 'FileOperations') n.fileOperation = 'Read';
    if (type === 'InvokeSoapService') n.soapEnvelope = '<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n\n  </soap:Body>\n</soap:Envelope>';
    this.def.nodes.push(n); this.selNode = n.id; this.selEdge = null; this.palette = false;
    setTimeout(() => this.props = true, 250);
  }

  testCond(n: WorkflowNode) {
    let data: Record<string, any>; try { data = JSON.parse(this.testJson || '{}'); } catch { this.testErr = 'Sample data must be valid JSON.'; this.testRes = null; return; }
    this.testErr = ''; this.wf.testCondition(n.conditionExpression || '', data).subscribe({ next: r => this.testRes = r, error: () => { this.testErr = 'Could not reach the server.'; this.testRes = null; } });
  }

  // ---- save / publish / run ----
  private async say(message: string, color = 'success') { (await this.toast.create({ message, duration: 2600, color })).present(); }
  save() {
    const body = { name: this.def.name, description: this.def.description, nodes: this.def.nodes, edges: this.def.edges };
    const done = (d: WorkflowDefinition) => { this.def = d; this.say('Saved'); if (this.route.snapshot.paramMap.get('id') !== d.id) this.router.navigate(['/workflow/designer', d.id], { replaceUrl: true }); };
    const err = (e: any) => this.say('Save failed: ' + (e.error?.message ?? e.error ?? e.message), 'danger');
    (this.def.id ? this.wf.updateDefinition(this.def.id, body) : this.wf.createDefinition(body)).subscribe({ next: done, error: err });
  }
  publish() {
    const starts = this.def.nodes.filter(n => n.type === 'Start').length;
    if (starts !== 1) { this.say('Workflow must have exactly one Start step.', 'danger'); return; }
    if (!this.def.nodes.some(n => n.type === 'End')) { this.say('Workflow needs at least one End step.', 'danger'); return; }
    this.wf.updateDefinition(this.def.id, { name: this.def.name, description: this.def.description, nodes: this.def.nodes, edges: this.def.edges }).subscribe({
      next: () => this.wf.publishDefinition(this.def.id).subscribe({ next: d => { this.def = d; this.say('Published'); }, error: e => this.say('Cannot publish: ' + (e.error?.message ?? e.error ?? e.message), 'danger') }),
      error: e => this.say('Save failed: ' + (e.error?.message ?? e.message), 'danger') });
  }
  run() {
    this.wf.startInstance(this.def.id).subscribe({ next: i => this.router.navigate(['/workflow/instances', i.id]), error: e => this.say('Cannot start: ' + (e.error?.message ?? e.error ?? e.message), 'danger') });
  }
}
