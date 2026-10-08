import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { WorkflowDefinition, WorkflowInstance, WorkflowTask, User, ConditionEvalResult, ActivityLogEntry } from '../models/workflow.models';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private base = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  // ---- Definitions (designer) ----
  getDefinitions(): Observable<WorkflowDefinition[]> {
    return this.http.get<WorkflowDefinition[]>(`${this.base}/definitions`);
  }

  getDefinition(id: string): Observable<WorkflowDefinition> {
    return this.http.get<WorkflowDefinition>(`${this.base}/definitions/${id}`);
  }

  createDefinition(def: Pick<WorkflowDefinition, 'name' | 'description' | 'nodes' | 'edges'>): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.base}/definitions`, def);
  }

  updateDefinition(id: string, def: Pick<WorkflowDefinition, 'name' | 'description' | 'nodes' | 'edges'>): Observable<WorkflowDefinition> {
    return this.http.put<WorkflowDefinition>(`${this.base}/definitions/${id}`, def);
  }

  publishDefinition(id: string): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.base}/definitions/${id}/publish`, {});
  }

  deleteDefinition(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/definitions/${id}`);
  }

  // ---- Instances ----
  // startedBy is no longer passed by the client - the API derives it from the JWT.
  startInstance(definitionId: string, initialData?: Record<string, any>): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.base}/instances/start`, { definitionId, initialData });
  }

  getInstances(): Observable<WorkflowInstance[]> {
    return this.http.get<WorkflowInstance[]>(`${this.base}/instances`);
  }

  cancelInstance(id: string): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.base}/instances/${id}/cancel`, {});
  }

  getInstance(id: string): Observable<WorkflowInstance> {
    return this.http.get<WorkflowInstance>(`${this.base}/instances/${id}`);
  }

  // The persisted activity log (DB table + file, see backend README section "Execution
  // logging") - a separate, durable record of every node action, independent of the
  // instance's own JSON history blob.
  getActivityLog(id: string): Observable<ActivityLogEntry[]> {
    return this.http.get<ActivityLogEntry[]>(`${this.base}/instances/${id}/activity-log`);
  }

  // ---- Tasks (inbox / approve-reject) ----
  // Always scoped server-side to the logged-in user (by username or role) - no assignee param.
  getTasks(includeCompleted = false): Observable<WorkflowTask[]> {
    return this.http.get<WorkflowTask[]>(`${this.base}/tasks?includeCompleted=${includeCompleted}`);
  }

  completeTask(taskId: string, decision: string, formData: Record<string, any>, comment: string): Observable<WorkflowTask> {
    return this.http.post<WorkflowTask>(`${this.base}/tasks/${taskId}/complete`, { decision, formData, comment });
  }

  // ---- Users (designer's assignee picker) ----
  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.base}/users`);
  }

  // ---- Condition tester (designer) ----
  testCondition(expression: string, data: Record<string, any>): Observable<ConditionEvalResult> {
    return this.http.post<ConditionEvalResult>(`${this.base}/definitions/test-condition`, { expression, data });
  }
}
