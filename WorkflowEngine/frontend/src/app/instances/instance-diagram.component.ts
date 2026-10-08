import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NODE_PALETTE, NodeType, WorkflowDefinition, WorkflowEdge, WorkflowInstance, WorkflowNode } from '../core/models/workflow.models';

interface DiagramNode extends WorkflowNode {
  state: 'pending' | 'visited' | 'active' | 'rejected';
}

@Component({
  selector: 'app-instance-diagram',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="diagram-wrap" *ngIf="definition">
      <div class="legend">
        <span class="legend-item"><i class="dot active"></i> In progress</span>
        <span class="legend-item"><i class="dot visited"></i> Completed</span>
        <span class="legend-item"><i class="dot rejected"></i> Rejected path</span>
        <span class="legend-item"><i class="dot pending"></i> Not reached</span>
      </div>

      <svg [attr.viewBox]="viewBox" class="canvas" preserveAspectRatio="xMinYMin meet">
        <defs>
          <marker id="arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-dim)" />
          </marker>
          <marker id="arrow-live" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#37c26f" />
          </marker>
          <marker id="arrow-rejected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#e0555c" />
          </marker>
        </defs>

        <!-- Edges: dim if never traveled, colored + thick if traveled -->
        <g *ngFor="let e of definition.edges">
          <path [attr.d]="edgePath(e)"
                class="edge"
                [class.traveled]="isEdgeTraveled(e)"
                [class.rejected]="isEdgeRejected(e)"
                [attr.marker-end]="markerFor(e)" />
        </g>

        <!-- Nodes: same shape convention as the designer canvas (circle Start/End, diamond
             gateways, rounded card for activities) - matches Skelta Process Designer. Click
             any node to see exactly what happened there. -->
        <g *ngFor="let n of diagramNodes"
           [attr.transform]="'translate(' + n.x + ',' + n.y + ')'"
           class="node"
           [class]="n.state"
           [class.clickable]="n.state !== 'pending'"
           (click)="selectNode(n)">

          <ng-container [ngSwitch]="shapeFor(n.type)">
            <circle *ngSwitchCase="'circle'" cx="30" cy="30" r="30" class="node-box" [style.stroke]="colorFor(n.type)" />
            <path *ngSwitchCase="'diamond'" d="M 70 0 L 140 40 L 70 80 L 0 40 Z" class="node-box" [style.stroke]="colorFor(n.type)" />
            <rect *ngSwitchDefault width="140" height="60" rx="10" class="node-box" [style.stroke]="colorFor(n.type)" />
          </ng-container>

          <circle *ngIf="n.state === 'active' && shapeFor(n.type) === 'circle'" cx="30" cy="30" r="34" class="pulse-ring" />
          <circle *ngIf="n.state === 'active' && shapeFor(n.type) === 'diamond'" cx="70" cy="40" r="44" class="pulse-ring" />
          <circle *ngIf="n.state === 'active' && shapeFor(n.type) === 'rect'" cx="70" cy="30" r="34" class="pulse-ring" />

          <ng-container [ngSwitch]="shapeFor(n.type)">
            <text *ngSwitchCase="'circle'" x="30" y="35" text-anchor="middle" class="node-icon-center" [style.fill]="colorFor(n.type)">{{ iconFor(n.type) }}</text>
            <ng-container *ngSwitchCase="'diamond'">
              <text x="70" y="35" text-anchor="middle" class="node-icon-center" [style.fill]="colorFor(n.type)">{{ iconFor(n.type) }}</text>
              <text x="70" y="55" text-anchor="middle" class="node-name">{{ n.name.length > 14 ? (n.name | slice:0:14) + '…' : n.name }}</text>
            </ng-container>
            <ng-container *ngSwitchDefault>
              <text x="14" y="24" class="node-icon" [style.fill]="colorFor(n.type)">{{ iconFor(n.type) }}</text>
              <text x="38" y="24" class="node-type">{{ n.type }}</text>
              <text x="14" y="44" class="node-name">{{ n.name.length > 16 ? (n.name | slice:0:16) + '…' : n.name }}</text>
            </ng-container>
          </ng-container>
          <text *ngIf="shapeFor(n.type) === 'circle'" x="30" y="98" text-anchor="middle" class="node-name">{{ n.name.length > 14 ? (n.name | slice:0:14) + '…' : n.name }}</text>

          <text [attr.x]="shapeFor(n.type) === 'circle' ? 52 : 122" y="14" class="state-badge" *ngIf="n.state === 'visited'">✓</text>
          <text [attr.x]="shapeFor(n.type) === 'circle' ? 52 : 122" y="14" class="state-badge rejected" *ngIf="n.state === 'rejected'">✕</text>
        </g>
      </svg>

      <!-- What happened at the selected node -->
      <div class="node-detail" *ngIf="selectedNode as sel">
        <div class="node-detail-header">
          <span class="icon" [style.color]="colorFor(sel.type)">{{ iconFor(sel.type) }}</span>
          <div>
            <div class="node-detail-title">{{ sel.name }}</div>
            <div class="node-detail-type">{{ sel.type }} · {{ sel.state === 'active' ? 'In progress' : sel.state === 'rejected' ? 'Rejected path' : sel.state === 'visited' ? 'Completed' : 'Not reached' }}</div>
          </div>
          <button class="close-btn" (click)="selectedNode = null">✕</button>
        </div>
        <div class="node-detail-body" *ngIf="entriesFor(sel).length > 0; else noEntries">
          <div class="entry" *ngFor="let h of entriesFor(sel)">
            <div class="entry-title">{{ h.action }}</div>
            <div class="entry-meta">{{ h.timestamp | date:'short' }}<span *ngIf="h.actor"> · {{ h.actor }}</span></div>
            <div class="entry-comment" *ngIf="h.comment">"{{ h.comment }}"</div>
          </div>
        </div>
        <ng-template #noEntries><p class="empty-note">This node hasn't been reached yet.</p></ng-template>
      </div>
    </div>
  `,
  styles: [`
    .diagram-wrap { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    .legend { display: flex; gap: 18px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--panel); font-size: 11px; color: var(--text-dim); }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .dot.active { background: var(--green); box-shadow: 0 0 6px var(--green); }
    .dot.visited { background: #5b8def; }
    .dot.rejected { background: var(--red); }
    .dot.pending { background: var(--text-dim); }

    .canvas { width: 100%; height: 380px; display: block; }

    .edge { fill: none; stroke: var(--border-strong); stroke-width: 2; }
    .edge.traveled { stroke: var(--green); stroke-width: 3; }
    .edge.traveled.rejected { stroke: var(--red); }

    .node .node-box { fill: var(--panel); stroke-width: 2; opacity: 0.45; }
    .node.visited .node-box, .node.active .node-box, .node.rejected .node-box { opacity: 1; }
    .node.active .node-box { stroke-width: 3; filter: drop-shadow(0 0 8px rgba(55,194,111,.6)); }
    .node.rejected .node-box { stroke: var(--red) !important; }
    .node .node-icon { font-size: 16px; opacity: 0.5; }
    .node .node-icon-center { font-size: 20px; opacity: 0.5; }
    .node.visited .node-icon, .node.active .node-icon, .node.rejected .node-icon,
    .node.visited .node-icon-center, .node.active .node-icon-center, .node.rejected .node-icon-center { opacity: 1; }
    .node-type { font-size: 9px; fill: var(--text-dim); text-transform: uppercase; letter-spacing: .5px; }
    .node-name { font-size: 12px; fill: var(--text); font-weight: 600; }
    .node.pending .node-name, .node.pending .node-type { opacity: 0.5; }

    .pulse-ring { fill: none; stroke: var(--green); stroke-width: 2; opacity: 0.6; animation: pulse 1.6s ease-out infinite; }
    @keyframes pulse {
      0% { r: 34; opacity: 0.6; }
      100% { r: 48; opacity: 0; }
    }

    .state-badge { font-size: 13px; fill: var(--green); font-weight: 700; }
    .state-badge.rejected { fill: var(--red); }

    .node.clickable { cursor: pointer; }

    .node-detail { border-top: 1px solid var(--border); background: var(--panel); padding: 14px 16px; }
    .node-detail-header { display: flex; align-items: center; gap: 10px; }
    .node-detail-header .icon { font-size: 18px; }
    .node-detail-title { font-size: 13px; font-weight: 700; }
    .node-detail-type { font-size: 11px; color: var(--text-dim); }
    .close-btn { margin-left: auto; background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 13px; padding: 4px 8px; }
    .close-btn:hover { color: var(--text); }
    .node-detail-body { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; max-height: 160px; overflow-y: auto; }
    .node-detail .entry-title { font-size: 12px; font-weight: 600; }
    .node-detail .entry-meta { font-size: 11px; color: var(--text-dim); }
    .node-detail .entry-comment { font-size: 11px; color: var(--text-dim); font-style: italic; }
    .empty-note { font-size: 12px; color: var(--text-dim); margin: 10px 0 0; }
  `]
})
export class InstanceDiagramComponent implements OnChanges {
  @Input() definition: WorkflowDefinition | null = null;
  @Input() instance: WorkflowInstance | null = null;

  diagramNodes: DiagramNode[] = [];
  viewBox = '0 0 1000 500';
  selectedNode: DiagramNode | null = null;
  private traveledEdgeIds = new Set<string>();
  private rejectedNodeIds = new Set<string>();

  ngOnChanges() {
    if (!this.definition || !this.instance) return;

    this.traveledEdgeIds = new Set(
      this.instance.history.filter(h => h.edgeId).map(h => h.edgeId as string)
    );

    // A node is on a "rejected" path if a Rejected history entry originated there, or if
    // it's only reachable via an edge labeled Reject that was actually traveled.
    this.rejectedNodeIds = new Set<string>();
    for (const h of this.instance.history) {
      if (h.action === 'Rejected') this.rejectedNodeIds.add(h.nodeId);
    }
    for (const e of this.definition.edges) {
      if (e.label === 'Reject' && this.traveledEdgeIds.has(e.id)) this.rejectedNodeIds.add(e.targetNodeId);
    }

    const visitedNodeIds = new Set(this.instance.history.map(h => h.nodeId));
    const activeNodeIds = new Set(this.instance.currentNodeIds);

    this.diagramNodes = this.definition.nodes.map(n => ({
      ...n,
      state: activeNodeIds.has(n.id) ? 'active'
        : this.rejectedNodeIds.has(n.id) ? 'rejected'
        : visitedNodeIds.has(n.id) ? 'visited'
        : 'pending'
    }));

    // Re-point the selection at the freshly-rebuilt node object (diagramNodes is recreated
    // every refresh) so the detail panel doesn't silently go stale while polling.
    if (this.selectedNode) {
      this.selectedNode = this.diagramNodes.find(n => n.id === this.selectedNode!.id) ?? null;
    }

    this.computeViewBox();
  }

  isEdgeTraveled(e: WorkflowEdge): boolean {
    return this.traveledEdgeIds.has(e.id);
  }

  selectNode(n: DiagramNode) {
    if (n.state === 'pending') return; // nothing happened here yet - nothing to show
    this.selectedNode = this.selectedNode?.id === n.id ? null : n;
  }

  entriesFor(n: DiagramNode) {
    return this.instance?.history.filter(h => h.nodeId === n.id) ?? [];
  }

  isEdgeRejected(e: WorkflowEdge): boolean {
    return e.label === 'Reject' && this.traveledEdgeIds.has(e.id);
  }

  markerFor(e: WorkflowEdge): string {
    if (this.isEdgeRejected(e)) return 'url(#arrow-rejected)';
    if (this.isEdgeTraveled(e)) return 'url(#arrow-live)';
    return 'url(#arrow-dim)';
  }

  colorFor(type: NodeType): string {
    return NODE_PALETTE.find(p => p.type === type)?.color ?? '#888';
  }

  iconFor(type: NodeType): string {
    return NODE_PALETTE.find(p => p.type === type)?.icon ?? '?';
  }

  shapeFor(type: NodeType): 'circle' | 'diamond' | 'rect' {
    if (type === 'Start' || type === 'End') return 'circle';
    if (type === 'Condition' || type === 'Switch' || type === 'ParallelSplit' || type === 'ParallelJoin') return 'diamond';
    return 'rect';
  }

  private nodeCenter(node: WorkflowNode) {
    const shape = this.shapeFor(node.type);
    if (shape === 'circle') return { x: node.x + 30, y: node.y + 30 };
    if (shape === 'diamond') return { x: node.x + 70, y: node.y + 40 };
    return { x: node.x + 70, y: node.y + 30 };
  }

  edgePath(edge: WorkflowEdge): string {
    const source = this.definition?.nodes.find(n => n.id === edge.sourceNodeId);
    const target = this.definition?.nodes.find(n => n.id === edge.targetNodeId);
    if (!source || !target) return '';
    const s = this.nodeCenter(source);
    const t = this.nodeCenter(target);
    const dx = (t.x - s.x) * 0.5;
    return `M ${s.x} ${s.y} C ${s.x + dx} ${s.y}, ${t.x - dx} ${t.y}, ${t.x} ${t.y}`;
  }

  private computeViewBox() {
    if (!this.definition || this.definition.nodes.length === 0) { this.viewBox = '0 0 1000 500'; return; }
    const pad = 60;
    const xs = this.definition.nodes.map(n => n.x);
    const ys = this.definition.nodes.map(n => n.y);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const maxX = Math.max(...xs) + 140 + pad;
    const maxY = Math.max(...ys) + 60 + pad;
    this.viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }
}
