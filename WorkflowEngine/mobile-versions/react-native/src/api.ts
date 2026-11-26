import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Session {
  server: string; token: string; id: string; username: string; displayName: string; role: string;
  permissions: string[]; tenantName?: string;
}
export interface ErpRec {
  id: string; module: string; kind: string; code?: string | null; company?: string | null; branch?: string | null;
  status?: string | null; ref?: string | null; parent?: string | null; data: Record<string, any>; createdBy?: string | null; createdAt?: string;
}
export interface WfTask { id: string; instanceId: string; nodeName: string; priority?: string; availableDecisions: string[]; createdAt: string; }
export interface WfInstance { id: string; definitionName: string; status: string; startedAt: string; data: Record<string, any>; history: { timestamp: string; nodeName: string; action: string; actor?: string; comment?: string }[]; }
export interface WfDefinition { id: string; name: string; description: string; }

const KEY = 'wfe_rn_session';
let session: Session | null = null;

export const defaultServer = 'http://10.0.2.2:5000';
export const getSession = () => session;
export async function loadSession(): Promise<Session | null> {
  try { const raw = await AsyncStorage.getItem(KEY); session = raw ? (JSON.parse(raw) as Session) : null; } catch { session = null; }
  return session;
}
async function saveSession(s: Session | null) {
  session = s;
  try { if (s) await AsyncStorage.setItem(KEY, JSON.stringify(s)); else await AsyncStorage.removeItem(KEY); } catch { /* storage is optional */ }
}
export const can = (p: string) => !!session && session.permissions.includes(p);
export const signOut = () => saveSession(null);

function base(server: string) { return server.replace(/\/+$/, '').replace(/\/api$/, '') + '/api'; }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!session) throw new Error('not signed in');
  const res = await fetch(base(session.server) + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) { await signOut(); throw new Error('401'); }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = j.message ?? j.error ?? j.title ?? text; } catch { /* plain text */ }
    throw new Error(msg || String(res.status));
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function login(server: string, username: string, password: string): Promise<Session> {
  const res = await fetch(base(server) + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('login');
  const j = await res.json();
  const s: Session = {
    server, token: j.token, id: j.id, username: j.username, displayName: j.displayName, role: j.role,
    permissions: j.permissions ?? [], tenantName: j.tenantName,
  };
  await saveSession(s);
  return s;
}

/** Re-reads the privileges (an admin may have changed them since sign-in). */
export async function refreshMe() {
  try {
    const me = await call<{ effectivePermissions: string[]; displayName: string; role: string }>('GET', '/users/me');
    if (session) await saveSession({ ...session, permissions: me.effectivePermissions ?? session.permissions, displayName: me.displayName, role: me.role });
  } catch { /* keep the cached privileges */ }
}

export const bizAction = (module: string, kind: string, id: string, op: string, body: unknown) => call('POST', `/erp/${module}/bizact/${kind}/${id}/${op}`, body);
export const tasks = () => call<WfTask[]>('GET', '/tasks');
export const completeTask = (id: string, decision: string, comment: string) => call('POST', `/tasks/${id}/complete`, { decision, formData: {}, comment });
export const instances = () => call<WfInstance[]>('GET', '/instances');
export const instance = (id: string) => call<WfInstance>('GET', `/instances/${id}`);
export const cancelInstance = (id: string) => call('POST', `/instances/${id}/cancel`, {});
export const definitions = () => call<WfDefinition[]>('GET', '/definitions');
export const startInstance = (definitionId: string, initialData: Record<string, any>) => call<WfInstance>('POST', '/instances/start', { definitionId, initialData });

export const records = (module: string, kind: string) => call<ErpRec[]>('GET', `/erp/${module}/records/${kind}?take=500`);
export const createRecord = (module: string, kind: string, r: Partial<ErpRec>) => call<ErpRec>('POST', `/erp/${module}/records/${kind}`, r);
export const updateRecord = (module: string, kind: string, id: string, r: Partial<ErpRec>) => call<ErpRec>('PUT', `/erp/${module}/records/${kind}/${id}`, r);
export const deleteRecord = (module: string, kind: string, id: string) => call<void>('DELETE', `/erp/${module}/records/${kind}/${id}`);
export const approvalAct = (id: string, op: 'approve' | 'reject', note: string) => call('POST', `/erp/gov/approvals/${id}/${op}`, { note });

export interface ChatAction { label: string; module: string; kind: string; id?: string | null; }
export interface ChatReply { reply: string; actions: ChatAction[]; suggestions: string[]; source?: string; }
/** The shared ERP assistant (POST api/assistant/chat): answers from the live data this user may see. */
export const chat = (message: string, lang: string, history: { from: string; text: string }[]) =>
  call<ChatReply>('POST', '/assistant/chat', { message, lang, history });
