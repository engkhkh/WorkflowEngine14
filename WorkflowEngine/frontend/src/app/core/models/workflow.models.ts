export type NodeType =
  | 'Start' | 'End' | 'FormTask' | 'ApprovalTask' | 'Condition' | 'Switch'
  | 'ParallelSplit' | 'ParallelJoin' | 'Timer' | 'Email' | 'WebhookCall' | 'Automation'
  | 'SubWorkflow' | 'DocumentGeneration' | 'InvokeSoapService' | 'FileOperations' | 'XmlAction'
  | 'DatabaseActivity' | 'Logger' | 'Notification' | 'SendSms' | 'CancelWorkflow';
export type FormFieldType = 'Text' | 'TextArea' | 'Number' | 'Date' | 'Select' | 'Checkbox' | 'Email';
export type InstanceStatus = 'Running' | 'Completed' | 'Terminated';
export type TaskStatus = 'Pending' | 'Completed';

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
  /** Effective privileges (from the server); undefined on sessions saved before privileges existed. */
  permissions?: string[];
  tenantId?: string;
  tenantName?: string;
}

export interface FormField {
  id: string;
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder?: string;
  options: FormFieldOption[];
  readOnly: boolean;
}

export interface FormDefinition {
  id: string;
  title: string;
  fields: FormField[];
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  assignee?: string;
  description?: string;
  form?: FormDefinition;
  conditionExpression?: string;
  automationAction?: string;
  scriptBody?: string;
  scriptLanguage?: string; // "JavaScript" (sandboxed) | "CSharp" (full trust, not sandboxed)

  // Escalation + priority (FormTask / ApprovalTask)
  escalateAfterMinutes?: number;
  escalateTo?: string;
  priority?: string; // Low | Normal | High | Urgent
  escalationMode?: string; // "Reassign" | "AutoComplete" | "Notify"
  timeoutDecision?: string; // outcome label to auto-fire when escalationMode = AutoComplete
  useBusinessHours?: boolean; // count only configured work hours/days toward escalateAfterMinutes

  // Timer
  durationSeconds?: number;

  // Email
  emailTo?: string;
  emailSubject?: string;
  emailBody?: string;
  emailIsHtml?: boolean;

  // WebhookCall
  webhookUrl?: string;
  webhookMethod?: string; // GET | POST | PUT | DELETE
  resultVariable?: string; // store the raw response under this exact data key

  // InvokeSoapService
  soapEnvelope?: string;
  soapAction?: string;

  // FileOperations (stub)
  fileOperation?: string; // Read | Write | Copy | Delete | Move
  filePath?: string;

  // XmlAction (stub)
  xmlXPath?: string;
  xmlSourceVariable?: string;

  // Automation / Email / WebhookCall / Timer: which outgoing edge label this stub node
  // always takes, since it can't really evaluate success/failure in this demo engine.
  defaultOutcome?: string;

  // Switch (n-way branch)
  switchField?: string;

  // SubWorkflow (stub - see backend WorkflowNode doc comment)
  subWorkflowDefinitionId?: string;
  subWorkflowDefinitionName?: string;

  // DocumentGeneration (stub)
  documentTemplate?: string;
  documentName?: string;

  // DatabaseActivity (stub)
  databaseConnectionName?: string;
  databaseQuery?: string;

  // Logger (real)
  logMessage?: string;

  // Notification (stub)
  notificationTo?: string;
  notificationMessage?: string;

  // SendSms (stub)
  smsTo?: string;
  smsMessage?: string;

  // CancelWorkflow (real)
  cancelReason?: string;
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  isPublished: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface HistoryEntry {
  timestamp: string;
  nodeId: string;
  nodeName: string;
  action: string;
  actor?: string;
  comment?: string;
  edgeId?: string;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionName: string;
  status: InstanceStatus;
  currentNodeIds: string[];
  data: Record<string, any>;
  history: HistoryEntry[];
  startedBy: string;
  startedAt: string;
  completedAt?: string;
}

export interface WorkflowTask {
  id: string;
  instanceId: string;
  definitionId: string;
  nodeId: string;
  nodeName: string;
  nodeType: NodeType;
  assignedTo?: string;
  priority?: string;
  status: TaskStatus;
  form?: FormDefinition;
  availableDecisions: string[]; // outcome buttons to render - arbitrary labels, not fixed Approve/Reject
  decision: string;
  submittedData?: Record<string, any>;
  comment?: string;
  escalateAfterMinutes?: number;
  escalateTo?: string;
  escalationMode?: string;
  timeoutDecision?: string;
  isEscalated: boolean;
  originalAssignee?: string;
  createdAt: string;
  completedAt?: string;
}

/** Which real product a feature was modeled after, shown as a badge in the designer/palette. */
export type Origin = 'skelta' | 'camunda' | 'n8n' | 'engine';

export const ORIGIN_LABELS: Record<Origin, { label: string; color: string }> = {
  skelta:  { label: 'Skelta',  color: '#e0a83a' },
  camunda: { label: 'Camunda', color: '#6d8cf0' },
  n8n:     { label: 'n8n',     color: '#f08fd0' },
  engine:  { label: 'Built for you', color: '#3ecb7e' },
};

/** Matches Skelta Process Designer's real Activities dropdown categories, so the palette
 * groups and reads the same way (Human Activities, Integration Activities, etc). */
export type NodeCategory = 'Human Activities' | 'Integration Activities' | 'Engine Activities' | 'Scheduler Activities' | 'Communication' | 'Custom Activities' | 'BPMN Elements' | 'Report Activities' | 'Security';

export const NODE_PALETTE: { type: NodeType; label: string; color: string; icon: string; origin: Origin; note: string; category: NodeCategory }[] = [
  { type: 'Start', label: 'Start', color: '#37c26f', icon: '▶', origin: 'camunda', note: 'BPMN start event', category: 'BPMN Elements' },
  { type: 'End', label: 'End', color: '#e0555c', icon: '■', origin: 'camunda', note: 'BPMN end event', category: 'BPMN Elements' },
  { type: 'Condition', label: 'Decision', color: '#e0a83a', icon: '◆', origin: 'camunda', note: 'BPMN exclusive gateway / Skelta Rule activity', category: 'BPMN Elements' },
  { type: 'Switch', label: 'Switch', color: '#e0a83a', icon: '⑄', origin: 'n8n', note: 'n8n Switch node - branch on a field\'s value, more than just True/False', category: 'BPMN Elements' },
  { type: 'ParallelSplit', label: 'Parallel Split', color: '#e0a83a', icon: '⑂', origin: 'camunda', note: 'BPMN parallel gateway (fork)', category: 'BPMN Elements' },
  { type: 'ParallelJoin', label: 'Parallel Join', color: '#e0a83a', icon: '⑃', origin: 'camunda', note: 'BPMN parallel gateway (join/sync)', category: 'BPMN Elements' },

  { type: 'FormTask', label: 'Form Task', color: '#f0a3a8', icon: '📝', origin: 'skelta', note: 'Skelta Web/InfoPath form activity', category: 'Human Activities' },
  { type: 'ApprovalTask', label: 'Task / Approval', color: '#f0a3a8', icon: '✓', origin: 'skelta', note: 'Skelta Task/Approval activity - any number of custom outcome buttons', category: 'Human Activities' },

  { type: 'WebhookCall', label: 'Invoke Web API', color: '#f0a3a8', icon: '🌐', origin: 'n8n', note: 'n8n HTTP Request node / Skelta Invoke Web API (REST) - really calls it', category: 'Integration Activities' },
  { type: 'InvokeSoapService', label: 'InvokeWebService', color: '#f0a3a8', icon: '🧷', origin: 'skelta', note: 'Skelta Integration Activity (SOAP/XML) - really calls it', category: 'Integration Activities' },
  { type: 'Automation', label: 'Script', color: '#f0a3a8', icon: '⚙', origin: 'n8n', note: 'n8n code/script node / Skelta Script activity - JS/C# really execute', category: 'Integration Activities' },
  { type: 'FileOperations', label: 'File Operations', color: '#f0a3a8', icon: '🗂', origin: 'skelta', note: 'Skelta Integration Activity - read/write/copy/delete a file (stub)', category: 'Integration Activities' },
  { type: 'XmlAction', label: 'XML Action', color: '#f0a3a8', icon: '{x}', origin: 'skelta', note: 'Skelta Integration Activity - query/transform XML (stub)', category: 'Integration Activities' },
  { type: 'DocumentGeneration', label: 'Create-Open-Office-Document', color: '#f0a3a8', icon: '📄', origin: 'skelta', note: 'Skelta document-generation activity (stub)', category: 'Integration Activities' },

  { type: 'DatabaseActivity', label: 'Database Activity', color: '#6d8cf0', icon: '🗄', origin: 'skelta', note: 'Skelta Engine Activity - run a query (stub - a real trust decision, same as C# scripting)', category: 'Engine Activities' },
  { type: 'Logger', label: 'Logger', color: '#6d8cf0', icon: '🪵', origin: 'skelta', note: 'Skelta Engine Activity - really logs a message to the instance history', category: 'Engine Activities' },
  { type: 'SubWorkflow', label: 'End Child Workflow Execution', color: '#6d8cf0', icon: '⧉', origin: 'camunda', note: 'Camunda Call Activity - invoke another workflow (stub)', category: 'Engine Activities' },

  { type: 'Timer', label: 'Time Trigger', color: '#8f97ff', icon: '⏱', origin: 'skelta', note: 'Skelta TimerTriggerAction (delay / retry wait) - really waits', category: 'Scheduler Activities' },

  { type: 'Email', label: 'Email', color: '#f08fd0', icon: '✉', origin: 'skelta', note: 'Skelta Information/Email activity - really sends via SMTP', category: 'Communication' },
  { type: 'Notification', label: 'Notification', color: '#f08fd0', icon: '🔔', origin: 'skelta', note: 'Skelta Communication activity - in-app/push notification (stub)', category: 'Communication' },
  { type: 'SendSms', label: 'Send SMS', color: '#f08fd0', icon: '📱', origin: 'skelta', note: 'Skelta Communication activity - sends an SMS (stub)', category: 'Communication' },

  { type: 'CancelWorkflow', label: 'Cancel Approval Workflow', color: '#e0555c', icon: '🚫', origin: 'skelta', note: 'Skelta Security activity - really cancels the running instance from within the flow', category: 'Security' },
];

export const NODE_CATEGORIES: NodeCategory[] = ['BPMN Elements', 'Human Activities', 'Integration Activities', 'Engine Activities', 'Scheduler Activities', 'Communication', 'Security'];

// The full real Skelta Process Designer taxonomy also includes: List Activities, Microsoft
// SharePoint Activities, Report Activities, SOA Activities, ArchestrA Events, SAP Activities,
// RabbitMQ, and Logic App. Deliberately not modeled here - each targets a specific external
// system (SharePoint, SAP, an ArchestrA/AVEVA industrial control plant, RabbitMQ, Azure Logic
// Apps) this generic engine has no real integration point for; adding stub nodes for them
// would just be clutter with zero functional value. Ask for any of these specifically if you
// actually need them and have the target system to integrate against - Report Activities in
// particular (Skelta's "Report Generator") would be a reasonable, bounded addition on request.

export const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

export interface ConditionClauseResult {
  clause: string;
  result: boolean;
}

export interface ConditionEvalResult {
  result: boolean;
  clauses: ConditionClauseResult[];
}

/** One persisted row from the ActivityLogs DB table - a durable, queryable record of a node
 * action, separate from WorkflowInstance.history (which lives inside that instance's JSON blob). */
export interface ActivityLogEntry {
  id: number;
  instanceId: string;
  definitionId: string;
  nodeId: string;
  nodeName: string;
  action: string;
  actor?: string;
  comment?: string;
  timestamp: string;
}

// ---------- SaaS: workspace (tenant), organisation, privileges ----------

export interface Tenant {
  id: string;
  name: string;
  plan: 'starter' | 'business' | 'enterprise';
  /** 0 = unlimited */
  maxUsers: number;
  maxCompanies: number;
  maxBranches: number;
  users: number;
  companies: number;
  branches: number;
}

export interface OrgSnapshot {
  tenant: Tenant;
  companies: { code: string; name: string; nameAr: string; currency: string; taxNo?: string }[];
  branches: { code: string; company: string; name: string; nameAr: string; warehouse: string; city?: string }[];
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  /** null = follows the role's default privileges */
  permissions: string[] | null;
  effectivePermissions: string[];
}

export interface SaveUserPayload {
  username?: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
  password?: string;
  permissions: string[] | null;
}

export interface PermissionCatalog {
  groups: { group: string; keys: string[] }[];
  roleDefaults: Record<string, string[]>;
  roles: string[];
}

export interface SignupPayload {
  workspaceName: string;
  displayName: string;
  email: string;
  username: string;
  password: string;
  currency: string;
  branchName?: string;
}
