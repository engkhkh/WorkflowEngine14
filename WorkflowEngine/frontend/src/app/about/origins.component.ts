import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../core/i18n/translate.pipe';

interface OriginItem { feature: string; detail: string; }
interface OriginGroup { key: string; title: string; color: string; blurb: string; items: OriginItem[]; }

const GROUPS: OriginGroup[] = [
  {
    key: 'skelta', title: 'From Skelta', color: '#e0a83a',
    blurb: 'Skelta is where the task/approval and forms model comes from - including patterns pulled directly from your own uploaded Skelta exports (SKWorkItem, SKHWSActivity, SKVirtualActor, and the two real flows you sent).',
    items: [
      { feature: 'Form Task / Approval Task nodes', detail: 'Maps to Skelta\'s "Task" activity - a human fills a form and/or picks an outcome.' },
      { feature: 'Arbitrary custom outcome buttons', detail: 'Not fixed to Approve/Reject - a task can offer any outcomes (e.g. "Suitable", "Canceled"), exactly like Skelta\'s configurable Task activities in your uploaded flows.' },
      { feature: 'Escalation (Reassign or Auto-Complete on timeout)', detail: 'Mirrors Skelta\'s escalation rules and the "Timeout Warning - Action" pattern seen in your Ambitious Transfer flow.' },
      { feature: 'Timer node', detail: 'Maps to Skelta\'s TimerTriggerAction, including the retry-wait-retry loop shape used throughout your uploaded flows.' },
      { feature: 'Email / Information node', detail: 'Maps to Skelta\'s Information/email activities used as terminal notices.' },
      { feature: 'Task priority & per-user/per-role inbox', detail: 'Mirrors Skelta\'s Queue + VirtualActor/VirtualRole dispatch model, simplified to a direct username-or-role match.' },
      { feature: 'Publish / Draft lifecycle', detail: 'Mirrors Skelta\'s workflow versioning (a definition must be published before it can be started).' },
    ]
  },
  {
    key: 'camunda', title: 'From Camunda', color: '#6d8cf0',
    blurb: 'Camunda is where the BPMN-style process-engine backbone comes from - gateways, tokens, and the process map visualization.',
    items: [
      { feature: 'Start / End events', detail: 'Standard BPMN boundary events.' },
      { feature: 'Condition (exclusive gateway)', detail: 'Branches on a data expression, like a BPMN XOR-gateway.' },
      { feature: 'Parallel Split / Parallel Join', detail: 'A real fork-join: concurrent tokens, and a join that waits for every distinct branch before continuing - a BPMN AND-gateway.' },
      { feature: 'Process Map (instance diagram)', detail: 'The live, highlighted flow-diagram view on an instance is modeled on Camunda Cockpit\'s process-instance viewer.' },
      { feature: 'Full audit trail / history per instance', detail: 'Every node entered, every decision, every escalation - Cockpit-style.' },
    ]
  },
  {
    key: 'n8n', title: 'From n8n', color: '#f08fd0',
    blurb: 'n8n is where the visual, click-to-connect canvas and the "integration step" nodes come from.',
    items: [
      { feature: 'Drag-and-connect designer canvas', detail: 'Click a source node then a target node to link them, the same interaction model as n8n\'s canvas.' },
      { feature: 'Webhook Call node', detail: 'Maps to n8n\'s HTTP Request node (and Skelta\'s "Invoke Web API" activity).' },
      { feature: 'Automation / script node', detail: 'Maps to n8n\'s Code node (and Skelta\'s "Script" activity) - a no-human-input processing step.' },
    ]
  },
  {
    key: 'engine', title: 'Built specifically for you', color: '#3ecb7e',
    blurb: 'Not copied from any of the three - built to fit your stack and your AmanaPortal integration.',
    items: [
      { feature: '.NET 8 + Angular, SQL Server via EF Core', detail: 'Matches your existing backend/frontend stack rather than Skelta\'s WebForms/proprietary runtime.' },
      { feature: 'Real Users table + JWT auth', detail: 'A first-class identity model designed to bridge cleanly to AmanaPortal\'s SystemUserID, the same way Skelta\'s SKVirtualActor.UserIDString does today.' },
      { feature: 'ExternalReferenceId correlation (proposed)', detail: 'A first-class, indexed column for joining back to Services.Requests / ProcessBasedRequests - Skelta buries this in a JSON blob; this engine would not.' },
      { feature: 'Four ready-made HR templates', detail: 'Leave Request, Clearance, Employee Transfer, New Start Work - plus your two recreated Skelta flows.' },
    ]
  },
];

@Component({
  selector: 'app-origins',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="page">
      <h1>{{ 'origins.title' | translate }}</h1>
      <p class="sub">This engine borrows deliberately from three real products, plus some pieces built fresh for your stack.</p>

      <div class="group" *ngFor="let g of groups">
        <div class="group-header">
          <span class="dot" [style.background]="g.color"></span>
          <h2>{{ g.title }}</h2>
        </div>
        <p class="blurb">{{ g.blurb }}</p>
        <div class="items">
          <div class="item" *ngFor="let it of g.items">
            <div class="item-feature">{{ it.feature }}</div>
            <div class="item-detail">{{ it.detail }}</div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 28px 32px; max-width: 900px; }
    h1 { font-size: 22px; margin: 0; }
    .sub { color: var(--text-dim); font-size: 13px; margin: 6px 0 28px; }
    .group { margin-bottom: 30px; }
    .group-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    h2 { font-size: 15px; margin: 0; }
    .blurb { color: var(--text-dim); font-size: 12px; margin: 0 0 14px; line-height: 1.6; }
    .items { display: flex; flex-direction: column; gap: 10px; }
    .item { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
    .item-feature { font-size: 13px; font-weight: 600; }
    .item-detail { font-size: 12px; color: var(--text-dim); margin-top: 3px; line-height: 1.5; }
  `]
})
export class OriginsComponent {
  groups = GROUPS;
}
