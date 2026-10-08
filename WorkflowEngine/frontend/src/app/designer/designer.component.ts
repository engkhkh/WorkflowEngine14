import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkflowService } from '../core/services/workflow.service';
import { AuthService } from '../core/services/auth.service';
import { NODE_PALETTE, NODE_CATEGORIES, NodeCategory, PRIORITIES, ORIGIN_LABELS, Origin, NodeType, WorkflowDefinition, WorkflowEdge, WorkflowNode, User, ConditionEvalResult } from '../core/models/workflow.models';
import { FormEditorComponent } from './form-editor.component';
import { TranslatePipe } from '../core/i18n/translate.pipe';

@Component({
  selector: 'app-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, FormEditorComponent, TranslatePipe],
  templateUrl: './designer.component.html',
  styleUrls: ['./designer.component.scss']
})
export class DesignerComponent implements OnInit {
  palette = NODE_PALETTE;
  categories = NODE_CATEGORIES;
  selectedCategory: NodeCategory = 'Human Activities';
  priorities = PRIORITIES;
  users: User[] = [];
  roles: string[] = [];
  publishedDefinitions: WorkflowDefinition[] = [];

  // Live "Test Condition" state - keyed loosely, only used while a Condition node is selected.
  testDataJson = '{\n  \n}';
  testResult: ConditionEvalResult | null = null;
  testError = '';
  definition: WorkflowDefinition = this.blankDefinition();

  selectedNodeId: string | null = null;
  selectedEdgeId: string | null = null;

  placingType: NodeType | null = null;
  linkMode = false;
  linkSourceId: string | null = null;

  draggingNodeId: string | null = null;
  private dragOffset = { x: 0, y: 0 };

  constructor(private route: ActivatedRoute, private wf: WorkflowService, private router: Router, public auth: AuthService) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.wf.getDefinition(id).subscribe(def => this.definition = def);
    }
    this.wf.getUsers().subscribe(users => {
      this.users = users;
      this.roles = [...new Set(users.map(u => u.role))].sort();
    });
    this.wf.getDefinitions().subscribe(defs => {
      // Only published flows make sense to invoke as a sub-workflow, and exclude this
      // flow itself to avoid an obviously-infinite self-reference.
      this.publishedDefinitions = defs.filter(d => d.isPublished && d.id !== this.definition.id);
    });
  }

  get isAdmin(): boolean {
    return this.auth.currentUser()?.role === 'admin';
  }

  onSubWorkflowSelected(node: WorkflowNode, definitionId: string) {
    node.subWorkflowDefinitionName = this.publishedDefinitions.find(d => d.id === definitionId)?.name;
  }

  // Assignee is stored as a comma-separated string (multi-user work items, Skelta-style);
  // the designer's native multi-select needs a real array to bind against.
  assigneeArray(n: WorkflowNode): string[] {
    return (n.assignee || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  setAssigneeArray(n: WorkflowNode, values: string[]) {
    n.assignee = values.join(',');
  }

  // Deliberately NOT bound via [ngModel] on the <select> itself - that binds to whatever
  // assigneeArray(n) returns, which is a brand-new array on every change-detection cycle
  // (since .split().filter() always allocates fresh), so Angular's multi-select value
  // accessor would think the value changed and rebuild every <option>'s selection state
  // on every single tick. Binding [selected] per-option and reading the change via a plain
  // DOM event instead avoids that entirely.
  isAssigned(n: WorkflowNode, value: string): boolean {
    return this.assigneeArray(n).includes(value);
  }

  onAssigneeChange(n: WorkflowNode, event: Event) {
    const select = event.target as HTMLSelectElement;
    const values = Array.from(select.selectedOptions).map(o => o.value);
    this.setAssigneeArray(n, values);
  }

  blankDefinition(): WorkflowDefinition {
    return {
      id: '',
      name: 'Untitled Flow',
      description: '',
      isPublished: false,
      version: 1,
      createdAt: '',
      updatedAt: '',
      nodes: [],
      edges: []
    };
  }

  get selectedNode(): WorkflowNode | undefined {
    return this.definition.nodes.find(n => n.id === this.selectedNodeId);
  }

  get selectedEdge(): WorkflowEdge | undefined {
    return this.definition.edges.find(e => e.id === this.selectedEdgeId);
  }

  get selectedEdgeSourceType(): NodeType | undefined {
    const edge = this.selectedEdge;
    if (!edge) return undefined;
    return this.definition.nodes.find(n => n.id === edge.sourceNodeId)?.type;
  }

  // ---------- Palette / placing ----------
  startPlacing(type: NodeType) {
    this.placingType = type;
    this.linkMode = false;
    this.linkSourceId = null;
  }

  /** Text-size setting scales the page with CSS zoom; pointer maths on the canvas has to undo it. */
  private zoom(): number {
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom'));
    return z > 0 ? z : 1;
  }

  onCanvasClick(evt: MouseEvent) {
    if (!this.placingType) return;
    const rect = (evt.currentTarget as SVGElement).getBoundingClientRect();
    const z = this.zoom();
    const x = (evt.clientX - rect.left) / z - 70;
    const y = (evt.clientY - rect.top) / z - 30;
    this.addNode(this.placingType, x, y);
    this.placingType = null;
  }

  addNode(type: NodeType, x: number, y: number) {
    const isTask = type === 'FormTask' || type === 'ApprovalTask';
    const node: WorkflowNode = {
      id: crypto.randomUUID(),
      type,
      name: type,
      x, y,
      assignee: isTask ? '' : undefined,
      priority: isTask ? 'Normal' : undefined,
      escalationMode: isTask ? 'Reassign' : undefined,
      form: isTask ? { id: crypto.randomUUID(), title: type, fields: [] } : undefined,
      conditionExpression: type === 'Condition' ? '' : undefined,
      automationAction: type === 'Automation' ? '' : undefined,
      durationSeconds: type === 'Timer' ? 60 : undefined,
      emailTo: type === 'Email' ? '' : undefined,
      emailSubject: type === 'Email' ? '' : undefined,
      emailBody: type === 'Email' ? '' : undefined,
      webhookUrl: (type === 'WebhookCall' || type === 'InvokeSoapService') ? '' : undefined,
      webhookMethod: type === 'WebhookCall' ? 'POST' : undefined,
      resultVariable: (type === 'WebhookCall' || type === 'InvokeSoapService') ? '' : undefined,
      soapEnvelope: type === 'InvokeSoapService' ? '<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n\n  </soap:Body>\n</soap:Envelope>' : undefined,
      soapAction: type === 'InvokeSoapService' ? '' : undefined,
      fileOperation: type === 'FileOperations' ? 'Read' : undefined,
      filePath: type === 'FileOperations' ? '' : undefined,
      xmlXPath: type === 'XmlAction' ? '' : undefined,
      xmlSourceVariable: type === 'XmlAction' ? '' : undefined,
      defaultOutcome: (type === 'Timer' || type === 'Email' || type === 'WebhookCall' || type === 'Automation'
        || type === 'SubWorkflow' || type === 'DocumentGeneration' || type === 'FileOperations' || type === 'XmlAction'
        || type === 'DatabaseActivity' || type === 'Notification' || type === 'SendSms') ? '' : undefined,
      switchField: type === 'Switch' ? '' : undefined,
      subWorkflowDefinitionId: type === 'SubWorkflow' ? '' : undefined,
      documentTemplate: type === 'DocumentGeneration' ? '' : undefined,
      documentName: type === 'DocumentGeneration' ? '' : undefined,
      databaseConnectionName: type === 'DatabaseActivity' ? '' : undefined,
      databaseQuery: type === 'DatabaseActivity' ? '' : undefined,
      logMessage: type === 'Logger' ? '' : undefined,
      notificationTo: type === 'Notification' ? '' : undefined,
      notificationMessage: type === 'Notification' ? '' : undefined,
      smsTo: type === 'SendSms' ? '' : undefined,
      smsMessage: type === 'SendSms' ? '' : undefined,
      cancelReason: type === 'CancelWorkflow' ? '' : undefined
    };
    this.definition.nodes.push(node);
    this.selectNode(node.id);
  }

  // ---------- Selection ----------
  selectNode(id: string) {
    if (this.linkMode) {
      this.handleLinkClick(id);
      return;
    }
    this.selectedNodeId = id;
    this.selectedEdgeId = null;
    this.testResult = null;
    this.testError = '';
  }

  testCondition() {
    const node = this.selectedNode;
    if (!node) return;
    let data: Record<string, any>;
    try {
      data = JSON.parse(this.testDataJson || '{}');
    } catch {
      this.testError = 'Sample data must be valid JSON.';
      this.testResult = null;
      return;
    }
    this.testError = '';
    this.wf.testCondition(node.conditionExpression || '', data).subscribe({
      next: r => this.testResult = r,
      error: () => { this.testError = 'Could not reach the server to test this.'; this.testResult = null; }
    });
  }

  selectEdge(id: string) {
    this.selectedEdgeId = id;
    this.selectedNodeId = null;
  }

  deleteSelected() {
    if (this.selectedNodeId) {
      const id = this.selectedNodeId;
      this.definition.nodes = this.definition.nodes.filter(n => n.id !== id);
      this.definition.edges = this.definition.edges.filter(e => e.sourceNodeId !== id && e.targetNodeId !== id);
      this.selectedNodeId = null;
    } else if (this.selectedEdgeId) {
      this.definition.edges = this.definition.edges.filter(e => e.id !== this.selectedEdgeId);
      this.selectedEdgeId = null;
    }
  }

  // ---------- Linking ----------
  toggleLinkMode() {
    this.linkMode = !this.linkMode;
    this.linkSourceId = null;
    this.placingType = null;
  }

  handleLinkClick(nodeId: string) {
    if (!this.linkSourceId) {
      this.linkSourceId = nodeId;
      return;
    }
    if (this.linkSourceId === nodeId) {
      this.linkSourceId = null;
      return;
    }
    const source = this.definition.nodes.find(n => n.id === this.linkSourceId)!;
    let label = 'Default';
    if (source.type === 'ApprovalTask') {
      const hasApprove = this.definition.edges.some(e => e.sourceNodeId === source.id && e.label === 'Approve');
      label = hasApprove ? 'Reject' : 'Approve';
    } else if (source.type === 'Condition') {
      const hasTrue = this.definition.edges.some(e => e.sourceNodeId === source.id && e.label === 'True');
      label = hasTrue ? 'False' : 'True';
    }
    const edge: WorkflowEdge = { id: crypto.randomUUID(), sourceNodeId: this.linkSourceId, targetNodeId: nodeId, label };
    this.definition.edges.push(edge);
    this.linkSourceId = null;
  }

  // ---------- Dragging ----------
  startDrag(evt: MouseEvent, node: WorkflowNode) {
    if (this.linkMode || this.placingType) return;
    evt.stopPropagation();
    this.draggingNodeId = node.id;
    const rect = (evt.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const z = this.zoom();
    this.dragOffset = { x: (evt.clientX - rect.left) / z - node.x, y: (evt.clientY - rect.top) / z - node.y };
    this.selectNode(node.id);
  }

  onCanvasMouseMove(evt: MouseEvent) {
    if (!this.draggingNodeId) return;
    const rect = (evt.currentTarget as SVGElement).getBoundingClientRect();
    const node = this.definition.nodes.find(n => n.id === this.draggingNodeId);
    if (!node) return;
    const z = this.zoom();
    node.x = (evt.clientX - rect.left) / z - this.dragOffset.x;
    node.y = (evt.clientY - rect.top) / z - this.dragOffset.y;
  }

  onCanvasMouseUp() {
    this.draggingNodeId = null;
  }

  // ---------- Edge geometry helpers (for the template) ----------
  // Circle/diamond nodes have a different local center than the old uniform 140x60 rect, so
  // edges need to anchor at the right point per shape or they'll visibly miss the node.
  nodeCenter(node: WorkflowNode) {
    const shape = this.shapeFor(node.type);
    if (shape === 'circle') return { x: node.x + 30, y: node.y + 30 };
    if (shape === 'diamond') return { x: node.x + 70, y: node.y + 40 };
    return { x: node.x + 70, y: node.y + 30 };
  }

  edgePath(edge: WorkflowEdge): string {
    const source = this.definition.nodes.find(n => n.id === edge.sourceNodeId);
    const target = this.definition.nodes.find(n => n.id === edge.targetNodeId);
    if (!source || !target) return '';
    const s = this.nodeCenter(source);
    const t = this.nodeCenter(target);
    const dx = (t.x - s.x) * 0.5;
    return `M ${s.x} ${s.y} C ${s.x + dx} ${s.y}, ${t.x - dx} ${t.y}, ${t.x} ${t.y}`;
  }

  edgeMidpoint(edge: WorkflowEdge) {
    const source = this.definition.nodes.find(n => n.id === edge.sourceNodeId);
    const target = this.definition.nodes.find(n => n.id === edge.targetNodeId);
    if (!source || !target) return { x: 0, y: 0 };
    const s = this.nodeCenter(source);
    const t = this.nodeCenter(target);
    return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
  }

  colorFor(type: NodeType): string {
    return this.palette.find(p => p.type === type)?.color ?? '#888';
  }

  iconFor(type: NodeType): string {
    return this.palette.find(p => p.type === type)?.icon ?? '?';
  }

  // Matches the shape convention in the real Skelta Process Designer screenshot: Start/End
  // are circles, gateways (Condition/Switch/ParallelSplit/ParallelJoin) are diamonds,
  // everything else is a rounded activity card.
  shapeFor(type: NodeType): 'circle' | 'diamond' | 'rect' {
    if (type === 'Start' || type === 'End') return 'circle';
    if (type === 'Condition' || type === 'Switch' || type === 'ParallelSplit' || type === 'ParallelJoin') return 'diamond';
    return 'rect';
  }

  get paletteInCategory() {
    return this.palette.filter(p => p.category === this.selectedCategory);
  }

  originLabel(o: Origin): string {
    return ORIGIN_LABELS[o].label;
  }

  originColor(o: Origin): string {
    return ORIGIN_LABELS[o].color;
  }

  // ---------- Save / publish / test ----------
  save() {
    const req = this.definition.id
      ? this.wf.updateDefinition(this.definition.id, this.definition)
      : this.wf.createDefinition(this.definition);
    req.subscribe(saved => {
      this.definition = saved;
      if (!this.route.snapshot.paramMap.get('id')) {
        this.router.navigate(['/designer', saved.id]);
      }
      alert('Saved.');
    });
  }

  publish() {
    if (!this.definition.id) {
      alert('Save the flow first.');
      return;
    }
    this.wf.publishDefinition(this.definition.id).subscribe({
      next: def => { this.definition = def; alert('Published! It can now be started.'); },
      error: err => alert('Cannot publish: ' + (err.error ?? err.message))
    });
  }

  testRun() {
    if (!this.definition.id) { alert('Save the flow first.'); return; }
    this.wf.startInstance(this.definition.id, {}).subscribe(instance => {
      this.router.navigate(['/instances', instance.id]);
    });
  }
}
