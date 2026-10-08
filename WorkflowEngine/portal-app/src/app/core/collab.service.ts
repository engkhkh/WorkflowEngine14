import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api/api-client';

export interface CollabNote { id: string; text: string; system: boolean; author: string; createdAt: string; }
export interface CollabFile { id: string; name: string; type: string; size: number; author: string; createdAt: string; }
export interface CollabConfig<D = any> { id: string; name: string; shared: boolean; author: string; mine: boolean; data: D; }
export type CollabKind = 'filter' | 'report';

/** Chatter (notes + activity log), attachments, saved filters and saved report layouts for any record list. Stored server-side per workspace. */
@Injectable({ providedIn: 'root' })
export class CollabService {
  constructor(private api: ApiClient) {}

  notes(module: string, kind: string, id: string): Observable<CollabNote[]> { return this.api.get<CollabNote[]>(`collab/${module}/${kind}/${id}/notes`); }
  addNote(module: string, kind: string, id: string, text: string, system = false): Observable<CollabNote> { return this.api.post<CollabNote>(`collab/${module}/${kind}/${id}/notes`, { text, system }); }
  deleteNote(id: string): Observable<void> { return this.api.delete<void>(`collab/notes/${id}`); }

  files(module: string, kind: string, id: string): Observable<CollabFile[]> { return this.api.get<CollabFile[]>(`collab/${module}/${kind}/${id}/files`); }
  addFile(module: string, kind: string, id: string, f: { name: string; type: string; content: string }): Observable<CollabFile> { return this.api.post<CollabFile>(`collab/${module}/${kind}/${id}/files`, f); }
  deleteFile(id: string): Observable<void> { return this.api.delete<void>(`collab/files/${id}`); }
  fileBlob(id: string): Observable<Blob> { return this.api.blob(`collab/files/${id}`); }

  configs<D = any>(kind: CollabKind, view: string): Observable<CollabConfig<D>[]> { return this.api.get<CollabConfig<D>[]>(`collab/configs/${kind}`, { params: { view } }); }
  saveConfig<D = any>(kind: CollabKind, view: string, name: string, shared: boolean, data: D): Observable<CollabConfig<D>> {
    return this.api.post<CollabConfig<D>>(`collab/configs/${kind}`, { name, shared, data }, { params: { view } });
  }
  deleteConfig(kind: CollabKind, id: string): Observable<void> { return this.api.delete<void>(`collab/configs/${kind}/${id}`); }
}
