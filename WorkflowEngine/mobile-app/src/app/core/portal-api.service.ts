import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AdminUser, OrgSnapshot, PermissionCatalog, RbacCatalog, SaveUserPayload, WorkflowDefinitionSummary, WorkflowInstance, WorkflowTask
} from './models';
import { Branch, Company } from './erp.config';

@Injectable({ providedIn: 'root' })
export class PortalApiService {
  private base = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  getPublishedDefinitions(): Observable<WorkflowDefinitionSummary[]> {
    return this.http.get<WorkflowDefinitionSummary[]>(`${this.base}/definitions`);
  }

  startInstance(definitionId: string, initialData: Record<string, any> = {}): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.base}/instances/start`, { definitionId, initialData });
  }

  getInstances(): Observable<WorkflowInstance[]> {
    return this.http.get<WorkflowInstance[]>(`${this.base}/instances`);
  }

  getInstance(id: string): Observable<WorkflowInstance> {
    return this.http.get<WorkflowInstance>(`${this.base}/instances/${id}`);
  }

  cancelInstance(id: string): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.base}/instances/${id}/cancel`, {});
  }

  getTasks(includeCompleted = false): Observable<WorkflowTask[]> {
    return this.http.get<WorkflowTask[]>(`${this.base}/tasks?includeCompleted=${includeCompleted}`);
  }

  completeTask(taskId: string, decision: string, formData: Record<string, any>, comment: string): Observable<WorkflowTask> {
    return this.http.post<WorkflowTask>(`${this.base}/tasks/${taskId}/complete`, { decision, formData, comment });
  }

  // ---------- Admin module: users & privileges ----------
  getPermissionCatalog(): Observable<PermissionCatalog> { return this.http.get<PermissionCatalog>(`${this.base}/users/permissions`); }
  rbacGet(): Observable<RbacCatalog> { return this.http.get<RbacCatalog>(`${this.base}/admin/rbac`); }
  rbacSaveRole(role: string, b: { name?: string; permissions: string[] }): Observable<RbacCatalog> { return this.http.put<RbacCatalog>(`${this.base}/admin/rbac/roles/${encodeURIComponent(role)}`, b); }
  rbacCreateRole(b: { role: string; name?: string; copyFrom?: string }): Observable<RbacCatalog> { return this.http.post<RbacCatalog>(`${this.base}/admin/rbac/roles`, b); }
  rbacDeleteRole(role: string): Observable<RbacCatalog> { return this.http.delete<RbacCatalog>(`${this.base}/admin/rbac/roles/${encodeURIComponent(role)}`); }
  rbacAddPermission(b: { key: string; group?: string; label?: string; route?: string }): Observable<RbacCatalog> { return this.http.post<RbacCatalog>(`${this.base}/admin/rbac/permissions`, b); }
  rbacSavePermission(key: string, b: { isActive?: boolean; label?: string; route?: string; group?: string }): Observable<RbacCatalog> { return this.http.put<RbacCatalog>(`${this.base}/admin/rbac/permissions/${encodeURIComponent(key)}`, b); }
  rbacDeletePermission(key: string): Observable<RbacCatalog> { return this.http.delete<RbacCatalog>(`${this.base}/admin/rbac/permissions/${encodeURIComponent(key)}`); }
  adminListUsers(): Observable<AdminUser[]> { return this.http.get<AdminUser[]>(`${this.base}/users/admin`); }
  adminCreateUser(p: SaveUserPayload): Observable<AdminUser> { return this.http.post<AdminUser>(`${this.base}/users/admin`, p); }
  adminUpdateUser(id: string, p: SaveUserPayload): Observable<AdminUser> { return this.http.put<AdminUser>(`${this.base}/users/admin/${id}`, p); }
  adminResetPassword(id: string, password: string): Observable<void> { return this.http.post<void>(`${this.base}/users/admin/${id}/reset-password`, { password }); }
  adminDeleteUser(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/users/admin/${id}`); }

  // ---------- Organisation: companies & branches (per workspace) ----------
  getOrg(): Observable<OrgSnapshot> { return this.http.get<OrgSnapshot>(`${this.base}/org`); }
  createCompany(c: Company): Observable<Company> { return this.http.post<Company>(`${this.base}/org/companies`, c); }
  updateCompany(code: string, c: Company): Observable<Company> { return this.http.put<Company>(`${this.base}/org/companies/${encodeURIComponent(code)}`, c); }
  deleteCompany(code: string): Observable<void> { return this.http.delete<void>(`${this.base}/org/companies/${encodeURIComponent(code)}`); }
  createBranch(b: Branch): Observable<Branch> { return this.http.post<Branch>(`${this.base}/org/branches`, b); }
  updateBranch(code: string, b: Branch): Observable<Branch> { return this.http.put<Branch>(`${this.base}/org/branches/${encodeURIComponent(code)}`, b); }
  deleteBranch(code: string): Observable<void> { return this.http.delete<void>(`${this.base}/org/branches/${encodeURIComponent(code)}`); }
}
