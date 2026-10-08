export type FormFieldType = 'Text' | 'TextArea' | 'Number' | 'Date' | 'Select' | 'Checkbox' | 'Email';

export interface FormFieldOption { label: string; value: string; }

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

export interface WorkflowNodeSummary {
  id: string;
  type: string;
  name: string;
  description?: string;
  assignee?: string;
}

export interface WorkflowDefinitionSummary {
  id: string;
  name: string;
  description: string;
  isPublished: boolean;
  nodes?: WorkflowNodeSummary[];
}

export interface HistoryEntry {
  timestamp: string;
  nodeId: string;
  nodeName: string;
  action: string;
  actor?: string;
  comment?: string;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionName: string;
  status: 'Running' | 'Completed' | 'Terminated';
  currentNodeIds?: string[];
  data: Record<string, any>;
  history: HistoryEntry[];
  startedBy: string;
  startedAt: string;
  completedAt?: string;
}

export interface WorkflowTask {
  id: string;
  instanceId: string;
  definitionId?: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  assignedTo?: string;
  priority?: 'Low' | 'Normal' | 'High' | 'Urgent' | string;
  status: 'Pending' | 'Completed';
  form?: FormDefinition;
  availableDecisions: string[];
  submittedData?: Record<string, any>;
  isEscalated?: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
  /** effective privileges from the server (undefined only for a session saved before privileges existed) */
  permissions?: string[];
  tenantId?: string;
  tenantName?: string;
}

/** One line of an ERP document (purchase requisition, sales order, expense claim...). */
export interface DocLine {
  item: string;
  description?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  amount: number;
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

/** Admin module: privilege catalog and roles as stored in the database (api/admin/rbac). */
export interface RbacPermission { key: string; group: string; label?: string | null; route?: string | null; sortOrder: number; isActive: boolean; isCustom: boolean; }
export interface RbacRole { role: string; name?: string | null; permissions: string[]; isSystem: boolean; customised: boolean; users: number; }
export interface RbacCatalog { permissions: RbacPermission[]; roles: RbacRole[]; }
