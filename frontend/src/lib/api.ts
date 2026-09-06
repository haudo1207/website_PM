import axios, { AxiosRequestConfig } from 'axios';
import { getToken, setToken, logout } from './auth';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
const api = axios.create({ baseURL: BASE, withCredentials: true });

const PROACTIVE_REFRESH_THRESHOLD_SECONDS = 60;

type AuthAwareConfig = AxiosRequestConfig & { _skipAuth?: boolean; _retried?: boolean };

interface RefreshResponse {
  access_token: string;
  token_type: string;
  role: string;
  full_name: string;
  avatar_url?: string | null;
  email?: string | null;
}

let refreshPromise: Promise<string | null> | null = null;

function decodeExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(decodeURIComponent(escape(window.atob(base64))));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await api.post<RefreshResponse>('/auth/refresh', null, { _skipAuth: true } as AuthAwareConfig);
      setToken(res.data.access_token);
      return res.data.access_token;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        // Session failure (expired/revoked/disabled) → clean logout.
        logout();
        return null;
      }
      // Temporary network/server failure: keep session state, do NOT logout.
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function restoreSession(): Promise<boolean> {
  const token = getToken();
  if (token) {
    const exp = decodeExp(token);
    if (exp !== null && exp - Math.floor(Date.now() / 1000) > PROACTIVE_REFRESH_THRESHOLD_SECONDS) {
      return true;
    }
  }
  const fresh = await refreshAccessToken();
  return !!fresh;
}

async function ensureFreshToken(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  const exp = decodeExp(token);
  if (exp === null) return token;
  const remaining = exp - Math.floor(Date.now() / 1000);
  if (remaining > PROACTIVE_REFRESH_THRESHOLD_SECONDS) return token;
  return refreshAccessToken();
}

api.interceptors.request.use(async cfg => {
  if ((cfg as AuthAwareConfig)._skipAuth) return cfg;
  const token = await ensureFreshToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  async err => {
    const cfg = err?.config as AuthAwareConfig | undefined;
    const status = err?.response?.status;
    const errorCode = err?.response?.headers?.['x-error-code'];
    if (!cfg) return Promise.reject(err);
    const isAuthEndpoint = typeof cfg.url === 'string' && cfg.url.startsWith('/auth/');

    if (status === 401 && !cfg._skipAuth) {
      if (isAuthEndpoint) {
        return Promise.reject(err);
      }
      if (errorCode === 'TOKEN_EXPIRED' && !cfg._retried) {
        // Explicitly expired Access JWT → refresh once, retry exactly once.
        const fresh = await refreshAccessToken();
        if (fresh) {
          cfg._retried = true;
          cfg.headers = { ...cfg.headers, Authorization: `Bearer ${fresh}` };
          return api(cfg);
        }
        return Promise.reject(err);
      }
      if (!getToken() && !cfg._retried) {
        // No Access JWT in memory (browser/computer restart, deep-link refresh):
        // attempt session restore from the HttpOnly refresh cookie, retry once.
        const fresh = await refreshAccessToken();
        if (fresh) {
          cfg._retried = true;
          cfg.headers = { ...cfg.headers, Authorization: `Bearer ${fresh}` };
          return api(cfg);
        }
        return Promise.reject(err);
      }
      // Any other authentication failure (invalid/tampered token, disabled
      // user...) → do NOT refresh → clean logout.
      logout();
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (e: string, p: string) =>
  api.post('/auth/login', new URLSearchParams({ username: e, password: p }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }).then(r => r.data);

export interface AuthConfig {
  google_login_enabled: boolean;
  google_client_id: string;
  password_login_enabled: boolean;
  outlook_login_enabled: boolean;
  outlook_client_id: string;
  outlook_tenant_id: string;
}

export const getAuthConfig = () => api.get<AuthConfig>('/auth/config').then(r => r.data);
export const googleLogin = (credential: string) =>
  api.post('/auth/google', { credential }).then(r => r.data);
export const outlookLogin = (credential: string) =>
  api.post('/auth/outlook', { credential }).then(r => r.data);

export interface MeProfile {
  id: number;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  role: string;
  data_scope: string;
  workspace_ids?: string[];
  workspaces?: Workspace[];
  member_id?: number | null;
  is_active: boolean;
  login_method: string;
  position?: string | null;
  department?: string | null;
  skills: string[];
  member: {
    display_name: string;
    team?: string | null;
    phone?: string | null;
    experience_year?: number | null;
    leader_name?: string | null;
    zalo_name?: string | null;
  } | null;
}
export const getMe = () => api.get<MeProfile>('/users/me').then(r => r.data);
export const updateMyZaloName = (zalo_name: string) =>
  api.patch<{ zalo_name: string | null }>('/users/me/zalo-name', { zalo_name }).then(r => r.data);

export interface LoginHistoryItem {
  id: number;
  action: string;
  outcome: string;
  login_method?: string | null;
  browser?: string | null;
  os?: string | null;
  device_type?: string | null;
  ip_address?: string | null;
  ip_risk?: string | null;
  is_new_ip: boolean;
  is_new_device: boolean;
  created_at: string | null;
}
export const getMyLoginHistory = (limit = 20) =>
  api.get<LoginHistoryItem[]>('/users/me/login-history', { params: { limit } }).then(r => r.data);

// ═══════════════════════════════════════════════════════════
// PROJECTS (v5)
// ═══════════════════════════════════════════════════════════
export const getProjects = (params?: {
  business_unit?: string;
  search?: string;
  customer?: string;
  customer_id?: number;
  year?: number;
  phase?: string;
  pm_ids?: string;
  sales_ids?: string;
  member_ids?: string;
  sort?: string;
}) => api.get('/projects', { params }).then(r => r.data);
export const getSidebarTree = (businessUnit?: string) =>
  api.get('/projects/sidebar-tree', { params: businessUnit ? { business_unit: businessUnit } : {} }).then(r => r.data);
export const getProject = (id: number) => api.get(`/projects/${id}`).then(r => r.data);
export const getPinnedProjectIds = () =>
  api.get<{ pinned_project_ids: number[] }>('/projects/pins').then(r => r.data.pinned_project_ids || []);
export const toggleProjectPin = (id: number) =>
  api.post<{ success: boolean; is_pinned: boolean }>(`/projects/${id}/pin`).then(r => r.data);
export const createProject = (data: object) => api.post('/projects', data).then(r => r.data);
export const updateProject = (id: number, data: object) => api.patch(`/projects/${id}`, data).then(r => r.data);
export const deleteProject = (id: number) => api.delete(`/projects/${id}`).then(r => r.data);
export const bulkDeleteProjects = (ids: number[]) =>
  api.post('/projects/bulk-delete', { ids }).then(r => r.data);

// Project Members
export const getProjectMembers = (pid: number) => api.get(`/projects/${pid}/members`).then(r => r.data);
export const addProjectMember = (pid: number, memberId: number, role?: string) =>
  api.post(`/projects/${pid}/members`, { member_id: memberId, role: role || 'Member' }).then(r => r.data);
export const removeProjectMember = (pid: number, memberId: number) =>
  api.delete(`/projects/${pid}/members/${memberId}`).then(r => r.data);

// Project Documents (Resources tab — "Trung tâm dữ liệu dự án")
export interface ProjectDocumentItem {
  id: number;
  project_id: number;
  name: string;
  doc_type: string;
  ext: string;
  phase_id: number | null;
  phase_name: string | null;
  task_id: number | null;
  task_label: string | null;
  source: 'file' | 'link';
  url: string | null;
  size_bytes: number | null;
  owner_member_id: number | null;
  owner_name: string | null;
  uploader_user_id: number | null;
  uploader_name: string;
  status: 'draft' | 'review' | 'approved';
  is_starred: boolean;
  version: number;
  created_at: string | null;
  updated_at: string | null;
}
export interface ProjectDocumentsResponse {
  items: ProjectDocumentItem[];
  metrics: { total: number; starred: number; review: number; approved: number; approved_pct: number };
  can_approve: boolean;
}
export const getProjectDocuments = (
  pid: number,
  params?: { special?: 'starred' | 'recent' | 'review'; phase_id?: number; q?: string; doc_type?: string; uploader_id?: number }
): Promise<ProjectDocumentsResponse> => api.get(`/projects/${pid}/documents`, { params }).then(r => r.data);
export const getProjectDocumentCategories = (pid: number) =>
  api.get(`/projects/${pid}/documents/categories`).then(r => r.data);
export const getProjectDocumentHistory = (pid: number, docId: number) =>
  api.get(`/projects/${pid}/documents/${docId}/history`).then(r => r.data);
export const createProjectDocument = (pid: number, data: FormData): Promise<ProjectDocumentItem> =>
  api.post(`/projects/${pid}/documents`, data).then(r => r.data);
export const updateProjectDocument = (pid: number, docId: number, data: FormData): Promise<ProjectDocumentItem> =>
  api.patch(`/projects/${pid}/documents/${docId}`, data).then(r => r.data);
export const approveProjectDocument = (pid: number, docId: number): Promise<ProjectDocumentItem> =>
  api.post(`/projects/${pid}/documents/${docId}/approve`).then(r => r.data);
export const rejectProjectDocument = (pid: number, docId: number): Promise<ProjectDocumentItem> =>
  api.post(`/projects/${pid}/documents/${docId}/reject`).then(r => r.data);
export const toggleStarProjectDocument = (pid: number, docId: number): Promise<ProjectDocumentItem> =>
  api.post(`/projects/${pid}/documents/${docId}/star`).then(r => r.data);
export const deleteProjectDocument = (pid: number, docId: number) =>
  api.delete(`/projects/${pid}/documents/${docId}`).then(r => r.data);
export const projectDocumentFileUrl = (pid: number, docId: number) => `${BASE}/projects/${pid}/documents/${docId}/file`;

// Phases
export const getPhases = (pid: number) => api.get(`/projects/${pid}/phases`).then(r => r.data);
export const createPhase = (pid: number, data: { name: string; description?: string }) =>
  api.post(`/projects/${pid}/phases`, data).then(r => r.data);
export const updatePhase = (pid: number, phid: number, data: object) =>
  api.patch(`/projects/${pid}/phases/${phid}`, data).then(r => r.data);
export const deletePhase = (pid: number, phid: number) =>
  api.delete(`/projects/${pid}/phases/${phid}`).then(r => r.data);

// Chat Groups (Project Links)
export const getChatGroups = (pid: number) => api.get(`/projects/${pid}/chat-groups`).then(r => r.data);
export const createChatGroup = (pid: number, d: { name: string; platform: string; link: string; desc?: string }) =>
  api.post(`/projects/${pid}/chat-groups`, d).then(r => r.data);
export const updateChatGroup = (pid: number, lid: number, d: object) =>
  api.patch(`/projects/${pid}/chat-groups/${lid}`, d).then(r => r.data);
export const deleteChatGroup = (pid: number, lid: number) =>
  api.delete(`/projects/${pid}/chat-groups/${lid}`).then(r => r.data);

// AI Task Inbox
export const getAITaskInbox = (pid: number) => api.get(`/projects/${pid}/ai-task-inbox`).then(r => r.data);
export const analyzeChatLogs = (pid: number, content: string, source_platform = 'Manual Paste', source_group_name = 'Manual Paste') =>
  api.post(`/projects/${pid}/ai-task-inbox/analyze`, { content, source_platform, source_group_name }).then(r => r.data);
export const updateAITaskInbox = (pid: number, tid: number, d: object) =>
  api.patch(`/projects/${pid}/ai-task-inbox/${tid}`, d).then(r => r.data);
export const rejectAITaskInbox = (pid: number, tid: number) =>
  api.delete(`/projects/${pid}/ai-task-inbox/${tid}`).then(r => r.data);
export const importAITaskToProjectPlan = (pid: number, tid: number, d?: { phase_id?: number; task_group_id?: number }) =>
  api.post(`/projects/${pid}/ai-task-inbox/${tid}/import`, d || {}).then(r => r.data);
export const bulkImportAITasks = (pid: number, taskIds: number[], d?: { phase_id?: number; task_group_id?: number }) =>
  api.post(`/projects/${pid}/ai-task-inbox/bulk-import`, { task_ids: taskIds, ...(d || {}) }).then(r => r.data);
export const getChatSyncLogs = (pid: number) => api.get(`/projects/${pid}/chat-sync-logs`).then(r => r.data);

// Platforms
export const getPlatforms = () => api.get('/platforms').then(r => r.data);
export const createPlatform = (data: { name: string; icon?: string; color?: string }) =>
  api.post('/platforms', data).then(r => r.data);

// ═══════════════════════════════════════════════════════════
// TASK GROUPS (v5)
// ═══════════════════════════════════════════════════════════
export const getTaskGroups = (phaseId: number) => api.get(`/phases/${phaseId}/task-groups`).then(r => r.data);
export const createTaskGroup = (phaseId: number, data: { name: string; description?: string }) =>
  api.post(`/phases/${phaseId}/task-groups`, data).then(r => r.data);
export const updateTaskGroup = (phaseId: number, gid: number, data: object) =>
  api.patch(`/phases/${phaseId}/task-groups/${gid}`, data).then(r => r.data);
export const deleteTaskGroup = (phaseId: number, gid: number) =>
  api.delete(`/phases/${phaseId}/task-groups/${gid}`).then(r => r.data);
export const reorderTaskGroups = (phaseId: number, order: number[]) =>
  api.patch(`/phases/${phaseId}/task-groups/reorder`, { order }).then(r => r.data);

// ═══════════════════════════════════════════════════════════
// TASKS (v5)
// ═══════════════════════════════════════════════════════════
export const getTasks = (groupId: number) => api.get(`/task-groups/${groupId}/tasks`).then(r => r.data);
export const getAllProjectTasks = (pid: number, phaseId?: number) =>
  api.get(`/projects/${pid}/all-tasks`, { params: phaseId ? { phase_id: phaseId } : {} }).then(r => r.data);
export const createTask = (groupId: number, data: object) =>
  api.post(`/task-groups/${groupId}/tasks`, data).then(r => r.data);
export const updateTask = (groupId: number, taskId: number, data: object) =>
  api.patch(`/task-groups/${groupId}/tasks/${taskId}`, data).then(r => r.data);
export const deleteTask = (groupId: number, taskId: number) =>
  api.delete(`/task-groups/${groupId}/tasks/${taskId}`).then(r => r.data);
export const duplicateTask = (groupId: number, taskId: number) =>
  api.post(`/task-groups/${groupId}/tasks/${taskId}/duplicate`).then(r => r.data);
// Task Review workflow (Leader Review) - review_status layer, separate from
// task.status. Requires project PM/Leader/Super Admin (is_project_leader).
export const approveTask = (groupId: number, taskId: number) =>
  api.post(`/task-groups/${groupId}/tasks/${taskId}/approve`).then(r => r.data);
export const requestTaskChanges = (groupId: number, taskId: number, reason: string) =>
  api.post(`/task-groups/${groupId}/tasks/${taskId}/request-changes`, { reason }).then(r => r.data);
export const requestTaskReview = (groupId: number, taskId: number) =>
  api.post(`/task-groups/${groupId}/tasks/${taskId}/request-review`).then(r => r.data);
// Task Blocking workflow (Leader Review) - is_blocked layer, separate from
// task.status. Same permission as generic task edit (project membership).
export const blockTask = (groupId: number, taskId: number, reason: string, blockedByTaskId?: number | null) =>
  api.post(`/task-groups/${groupId}/tasks/${taskId}/block`, { reason, blocked_by_task_id: blockedByTaskId || undefined }).then(r => r.data);
export const unblockTask = (groupId: number, taskId: number) =>
  api.post(`/task-groups/${groupId}/tasks/${taskId}/unblock`).then(r => r.data);
export const moveTask = (groupId: number, taskId: number, targetGroupId: number) =>
  api.post(`/task-groups/${groupId}/tasks/${taskId}/move`, { target_group_id: targetGroupId }).then(r => r.data);
export const moveTaskGroup = (phaseId: number, groupId: number, targetPhaseId: number) =>
  api.post(`/phases/${phaseId}/task-groups/${groupId}/move`, { target_phase_id: targetPhaseId }).then(r => r.data);
export const reorderTasks = (groupId: number, order: number[]) =>
  api.patch(`/task-groups/${groupId}/tasks/reorder`, { order }).then(r => r.data);

// ═══════════════════════════════════════════════════════════
// LEGACY COMPATIBLE (kept for Settings, Skills, System Categories, Members)
// ═══════════════════════════════════════════════════════════



// Users
export const getUsers = () => api.get('/users').then(r => r.data);
export const createUser = (d: object) => api.post('/users', d).then(r => r.data);
export const updateUser = (id: number, d: object) => api.put(`/users/${id}`, d).then(r => r.data);
export const deleteUser = (id: number) => api.delete(`/users/${id}`);

// Skills Master Data
export const getCategories = () => api.get('/skills/categories').then(r => r.data);
export const createCategory = (data: { name: string }) => api.post('/skills/categories', data).then(r => r.data);
export const updateCategory = (id: number, data: { name?: string; is_active?: boolean }) => api.put(`/skills/categories/${id}`, data).then(r => r.data);
export const deleteCategory = (id: number) => api.delete(`/skills/categories/${id}`).then(r => r.data);
export const createGroup = (data: { name: string; category_id: number }) => api.post('/skills/groups', data).then(r => r.data);
export const updateGroup = (id: number, data: { name?: string; category_id?: number }) => api.put(`/skills/groups/${id}`, data).then(r => r.data);
export const deleteGroup = (id: number) => api.delete(`/skills/groups/${id}`).then(r => r.data);
export const createSkill = (data: { name: string; group_id: number }) => api.post('/skills/skills', data).then(r => r.data);
export const updateSkill = (id: number, data: { name?: string; group_id?: number; is_active?: boolean }) => api.put(`/skills/skills/${id}`, data).then(r => r.data);
export const deleteSkill = (id: number) => api.delete(`/skills/skills/${id}`).then(r => r.data);

// System Categories
export const getPositions = () => api.get('/system-categories/positions').then(r => r.data);
export const createPosition = (data: { name: string; description?: string }) => api.post('/system-categories/positions', data).then(r => r.data);
export const updatePosition = (id: number, data: { name: string; description?: string }) => api.put(`/system-categories/positions/${id}`, data).then(r => r.data);
export const deletePosition = (id: number) => api.delete(`/system-categories/positions/${id}`).then(r => r.data);
export const getDepartments = () => api.get('/system-categories/departments').then(r => r.data);
export const createDepartment = (data: { name: string; description?: string }) => api.post('/system-categories/departments', data).then(r => r.data);
export const updateDepartment = (id: number, data: { name: string; description?: string }) => api.put(`/system-categories/departments/${id}`, data).then(r => r.data);
export const deleteDepartment = (id: number) => api.delete(`/system-categories/departments/${id}`).then(r => r.data);
export const getPriorities = () => api.get('/system-categories/priorities').then(r => r.data);
export const createPriority = (data: { name: string; kpi_base: number; color: string }) => api.post('/system-categories/priorities', data).then(r => r.data);
export const updatePriority = (id: number, data: { name: string; kpi_base: number; color: string }) => api.put(`/system-categories/priorities/${id}`, data).then(r => r.data);
export const deletePriority = (id: number) => api.delete(`/system-categories/priorities/${id}`).then(r => r.data);
export const getStatuses = () => api.get('/system-categories/statuses').then(r => r.data);
export const createStatus = (data: { name: string }) => api.post('/system-categories/statuses', data).then(r => r.data);
export const updateStatus = (id: number, data: { name: string }) => api.put(`/system-categories/statuses/${id}`, data).then(r => r.data);
export const deleteStatus = (id: number) => api.delete(`/system-categories/statuses/${id}`).then(r => r.data);
export const getTeams = () => api.get('/system-categories/teams').then(r => r.data);
export const createTeam = (data: { name: string; description?: string }) => api.post('/system-categories/teams', data).then(r => r.data);
export const updateTeam = (id: number, data: { name: string; description?: string }) => api.put(`/system-categories/teams/${id}`, data).then(r => r.data);
export const deleteTeam = (id: number) => api.delete(`/system-categories/teams/${id}`).then(r => r.data);

// Workspaces (Master Data — Single Source of Truth for Business Units)
export interface Workspace {
  id: number;
  name: string;
  code: string;
  description?: string | null;
}
export const getWorkspaces = () => api.get<Workspace[]>('/system-categories/workspaces').then(r => r.data);
export const createWorkspace = (data: { name: string; code: string; description?: string }) =>
  api.post('/system-categories/workspaces', data).then(r => r.data);
export const updateWorkspace = (id: number, data: { name?: string; code?: string; description?: string }) =>
  api.put(`/system-categories/workspaces/${id}`, data).then(r => r.data);
export const deleteWorkspace = (id: number) =>
  api.delete(`/system-categories/workspaces/${id}`).then(r => r.data);

// Members
export const getMembers = (params?: { search?: string; team?: string; position?: string; department?: string; workspace?: string; skill_id?: number; leader_name?: string }) =>
  api.get('/members', { params }).then(r => r.data);
export const getMember = (id: number) => api.get(`/members/${id}`).then(r => r.data);
export const createMember = (data: object) => api.post('/members', data).then(r => r.data);
export const updateMember = (id: number, data: object) => api.put(`/members/${id}`, data).then(r => r.data);
export const deleteMember = (id: number) => api.delete(`/members/${id}`).then(r => r.data);
export const syncFromRecruitment = () => api.post('/members/sync-from-recruitment').then(r => r.data);
export const getLeaders = () => api.get('/members/meta/leaders').then(r => r.data);

// Customers
export const getCustomers = (businessUnit?: string) =>
  api.get('/system-categories/customers', { params: businessUnit ? { business_unit: businessUnit } : {} }).then(r => r.data);
// Project Hub — Customers derived from linked Projects (Customer.business_unit
// is unreliable, see access.customer_query_for_user on the backend).
export const getCustomersByWorkspace = (code: string) =>
  api.get(`/system-categories/customers/by-workspace/${code}`).then(r => r.data);
export const createCustomer = (data: { name: string; description?: string; business_unit?: string }) =>
  api.post('/system-categories/customers', data).then(r => r.data);
export const updateCustomer = (id: number, data: { name: string; description?: string; business_unit?: string }) =>
  api.put(`/system-categories/customers/${id}`, data).then(r => r.data);
export const deleteCustomer = (id: number, cascadeProjects: boolean = false) => 
  api.delete(`/system-categories/customers/${id}`, { params: { cascade_projects: cascadeProjects } }).then(r => r.data);

// Lunch Records
export const getLunchRecords = (params?: { date?: string; member_id?: number }) =>
  api.get('/lunch', { params }).then(r => r.data);
export const upsertLunchRecord = (data: { member_id: number; date: string; has_lunch: boolean; status?: string }) =>
  api.post('/lunch', data).then(r => r.data);
export const deleteLunchRecord = (id: number) =>
  api.delete(`/lunch/${id}`).then(r => r.data);
export const getLunchMonthlySummary = (year: number, month: number) =>
  api.get('/lunch/monthly-summary', { params: { year, month } }).then(r => r.data);

// Leave Requests
export const getLeaveRequests = (params?: { status?: string; user_id?: number; from_date?: string; to_date?: string }) =>
  api.get('/leave-requests', { params }).then(r => r.data);
export const getLeaveRequest = (id: number) => api.get(`/leave-requests/${id}`).then(r => r.data);
export const createLeaveRequest = (data: object) => api.post('/leave-requests', data).then(r => r.data);
export const updateLeaveRequest = (id: number, data: object) => api.put(`/leave-requests/${id}`, data).then(r => r.data);
export const deleteLeaveRequest = (id: number) => api.delete(`/leave-requests/${id}`).then(r => r.data);
export const approveLeaveRequest = (id: number, status: 'Approved' | 'Rejected') =>
  api.patch(`/leave-requests/${id}/approve`, { status }).then(r => r.data);

// Meetings
export const getMeetings = (params?: { project_id?: number; status?: string; from_date?: string; to_date?: string; mine?: boolean; workspace?: string }) =>
  api.get('/meetings', { params }).then(r => r.data);

// Project Templates
export const getProjectTemplates = () => api.get('/project-templates').then(r => r.data);
export const createProjectTemplate = (data: object) => api.post('/project-templates', data).then(r => r.data);
export const updateProjectTemplate = (id: number, data: object) => api.put(`/project-templates/${id}`, data).then(r => r.data);
export const deleteProjectTemplate = (id: number) => api.delete(`/project-templates/${id}`).then(r => r.data);
export const applyProjectTemplate = (templateId: number, projectId: number) => api.post(`/project-templates/${templateId}/apply/${projectId}`).then(r => r.data);
export const getMeeting = (id: number) => api.get(`/meetings/${id}`).then(r => r.data);
export const createMeeting = (data: object) => api.post('/meetings', data).then(r => r.data);
export const updateMeeting = (id: number, data: object) => api.put(`/meetings/${id}`, data).then(r => r.data);
export const deleteMeeting = (id: number) => api.delete(`/meetings/${id}`).then(r => r.data);
export const updateTranscript = (id: number, transcript: string) => api.post(`/meetings/${id}/transcript`, { transcript }).then(r => r.data);
export const addMeetingMember = (id: number, memberId: number, role?: string) => api.post(`/meetings/${id}/members`, { member_id: memberId, role }).then(r => r.data);
export const removeMeetingMember = (id: number, memberId: number) => api.delete(`/meetings/${id}/members/${memberId}`).then(r => r.data);
export const syncMeeting = (id: number) => api.post(`/meetings/${id}/sync`).then(r => r.data);
export const generateMeetingLink = (data: { platform: string; title: string; date?: string; time?: string; duration?: string | number }) =>
  api.post('/meetings/generate-link', data).then(r => r.data);
export const getGoogleStatus = () => api.get('/meetings/google/status').then(r => r.data);
export const getGoogleAuthUrl = () => api.get('/meetings/google/auth').then(r => r.data);
export const pushMeetingTasks = (id: number, tasks: any[]) => api.post(`/meetings/${id}/push-tasks`, { tasks }).then(r => r.data);

// Meeting Intelligence — effectiveness score, feedback, AI copilot, insights
export const recalculateMeetingScore = (id: number) => api.post(`/meetings/${id}/recalculate-score`).then(r => r.data);
export const submitMeetingFeedback = (id: number, data: { helpful: boolean; comment?: string }) =>
  api.post(`/meetings/${id}/feedback`, data).then(r => r.data);
export const generateAiMeetingContent = (data: { title: string; project_name?: string }) =>
  api.post('/meetings/generate-ai-content', data).then(r => r.data);
export const getMeetingInsights = (params?: { from_date?: string; to_date?: string; workspace?: string }) =>
  api.get('/meetings/insights', { params }).then(r => r.data);

// AI prompt settings + transcript summarization — Next.js-local routes
// (app/api/ai/*), not the FastAPI backend, but routed through the same `api`
// client so they get the Authorization header + proactive token refresh
// every other call gets, instead of a bare fetch().
export const getAiSettings = () => api.get('/ai/settings').then(r => r.data);
export const saveAiSettings = (promptTemplate: string) => api.post('/ai/settings', { promptTemplate }).then(r => r.data);
export const summarizeMeetingTranscript = (meetingId: number, transcript: string) =>
  api.post('/ai/summarize', { meetingId, transcript }).then(r => r.data);

// Project Features — "Tính năng" + WIP log timeline
export const getProjectFeatures = (projectId: number) =>
  api.get(`/projects/${projectId}/features`).then(r => r.data);
export const createProjectFeature = (projectId: number, name: string) =>
  api.post(`/projects/${projectId}/features`, { name }).then(r => r.data);
export const renameProjectFeature = (projectId: number, featureId: number, name: string) =>
  api.patch(`/projects/${projectId}/features/${featureId}`, { name }).then(r => r.data);
export const deleteProjectFeature = (projectId: number, featureId: number) =>
  api.delete(`/projects/${projectId}/features/${featureId}`).then(r => r.data);
export const getProjectFeatureLogs = (projectId: number, featureId?: number) =>
  api.get(`/projects/${projectId}/feature-logs`, { params: featureId ? { feature_id: featureId } : {} }).then(r => r.data);
export const createProjectFeatureLog = (projectId: number, featureId: number, content: string, status?: string) =>
  api.post(`/projects/${projectId}/features/${featureId}/logs`, { content, status }).then(r => r.data);
export const deleteProjectFeatureLog = (projectId: number, logId: number) =>
  api.delete(`/projects/${projectId}/feature-logs/${logId}`).then(r => r.data);
export const getProjectFeatureLogAttachmentBlob = (projectId: number, logId: number, idx: number) =>
  api.get(`/projects/${projectId}/feature-logs/${logId}/attachments/${idx}`, { responseType: 'blob' }).then(r => r.data as Blob);
export const generateFeatureLogAiTasks = (projectId: number, logId: number) =>
  api.post(`/projects/${projectId}/feature-logs/${logId}/ai-tasks`).then(r => r.data);
export const pushFeatureLogTasks = (projectId: number, logId: number, tasks: any[]) =>
  api.post(`/projects/${projectId}/feature-logs/${logId}/push-tasks`, { tasks }).then(r => r.data);
export const uploadFeatureLogAttachment = (projectId: number, logId: number, file: File) =>
  new Promise<any>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      api.post(`/projects/${projectId}/feature-logs/${logId}/attachments`, {
        file_name: file.name,
        mime_type: file.type,
        base64: reader.result,
      }).then(r => resolve(r.data)).catch(reject);
    };
    reader.readAsDataURL(file);
  });



// Performance Settings CRUD
export const getPerformanceSettings = () => api.get('/performance-settings').then(r => r.data);
export const getParentRemarks = () => api.get('/performance-settings/parents').then(r => r.data);
export const createPerformanceSetting = (data: { performance: string; kpi: number; remark_type?: string; description?: string; sort_order?: number; is_active?: boolean; is_parent?: boolean; parent_id?: number | null }) => api.post('/performance-settings', data).then(r => r.data);
export const updatePerformanceSetting = (id: number, data: { performance?: string; kpi?: number; remark_type?: string; description?: string; sort_order?: number; is_active?: boolean; is_parent?: boolean; parent_id?: number | null }) => api.put(`/performance-settings/${id}`, data).then(r => r.data);
export const deletePerformanceSetting = (id: number) => api.delete(`/performance-settings/${id}`).then(r => r.data);


// Master Phases CRUD
export const getMasterPhases = () => api.get('/system-categories/master-phases').then(r => r.data);
export const createMasterPhase = (data: { name: string; description?: string }) => api.post('/system-categories/master-phases', data).then(r => r.data);
export const updateMasterPhase = (id: number, data: { name?: string; description?: string; sort_order?: number; is_active?: boolean }) => api.put(`/system-categories/master-phases/${id}`, data).then(r => r.data);
export const reorderMasterPhases = (ids: number[]) => api.put('/system-categories/master-phases/reorder', { ids }).then(r => r.data);
export const deleteMasterPhase = (id: number) => api.delete(`/system-categories/master-phases/${id}`).then(r => r.data);

// Accounts Management
export const getAccounts = () => api.get('/accounts').then(r => r.data);
export const getAvailableMembers = () => api.get('/accounts/available-members').then(r => r.data);
export const createAccount = (data: { email: string; password?: string; role: string; data_scope?: string; workspace_ids?: string[]; full_name?: string; member_id?: number; outlook_mail?: string }) => api.post('/accounts', data).then(r => r.data);
export const updateAccount = (id: number, data: { email?: string; full_name?: string; role?: string; data_scope?: string; workspace_ids?: string[]; member_id?: number | null; outlook_mail?: string | null }) => api.put(`/accounts/${id}`, data).then(r => r.data);
export const resetAccountPassword = (id: number, password: string) => api.post(`/accounts/${id}/reset-password`, { password }).then(r => r.data);
export const lockAccount = (id: number) => api.post(`/accounts/${id}/lock`).then(r => r.data);
export const unlockAccount = (id: number) => api.post(`/accounts/${id}/unlock`).then(r => r.data);
export const deleteAccount = (id: number) => api.delete(`/accounts/${id}`).then(r => r.data);

// ═══════════════════════════════════════════════════════════
// AI REVIEW (v5)
// ═══════════════════════════════════════════════════════════
export const getAIPrompts = (projectId: number) =>
  api.get('/settings/ai-prompts', { params: { project_id: projectId } }).then(r => r.data);

export const saveAIPrompt = (data: { id?: number; project_id: number; type: string; name: string; prompt_content: string; active?: boolean }) =>
  api.post('/settings/ai-prompts', data).then(r => r.data);

// projectId is only meaningful (and required backend-side) for entityType
// 'MEMBER' — a member has no project of their own, so the caller must say
// which project's tasks to scope the review to.
export const triggerAIReview = (entityType: string, entityId: number, projectId?: number) =>
  api.post('/ai-review/check', { entity_type: entityType, entity_id: entityId, project_id: projectId }).then(r => r.data);

export const getAIReviewHistory = (entityType: string, entityId: number, projectId?: number) =>
  api.get('/ai-review/history', { params: { entity_type: entityType, entity_id: entityId, project_id: projectId } }).then(r => r.data);

export const getAIReviewLog = (logId: number) =>
  api.get(`/ai-review/logs/${logId}`).then(r => r.data);

export const syncAITasksFromChat = (projectId: number) =>
  api.post(`/projects/${projectId}/ai-task-inbox/sync`).then(r => r.data);

// Audit Logs
export interface AuditLogItem {
  id: number;
  event_id?: string;
  project_id: number;
  module: string;
  entity_type: string;
  entity_id: string;
  action: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  description?: string;
  user_id?: number;
  user_name: string;
  created_at: string;
}

export const getProjectAuditLogs = (
  projectId: number,
  params?: {
    module?: string;
    action?: string;
    user_id?: number;
    search?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }
) => api.get<{ total: number; page: number; page_size: number; total_pages: number; items: AuditLogItem[] }>(`/projects/${projectId}/audit-logs`, { params }).then(r => r.data);

export const exportProjectAuditLogs = (projectId: number, params?: { module?: string; action?: string; user_id?: number; search?: string }) =>
  api.get(`/projects/${projectId}/audit-logs/export`, { params, responseType: 'blob' }).then(r => r.data);

// System Audit (Global Admin)
export interface SystemAuditChange {
  field_name: string;
  old_value: string;
  new_value: string;
  description: string;
}

export interface SystemAuditItem extends AuditLogItem {
  business_unit?: string;
  customer_id?: number;
  project_name?: string;
  resource_name?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  login_method?: string;
  source?: string;
  category?: 'Security' | 'Administration' | 'Configuration' | 'Integration' | 'System';
  session_id?: string;
  ip_risk?: 'Internal' | 'Trusted' | 'Unknown';
  correlation_id?: string;
  target_user_id?: number;
  target_user_name?: string;
  target_customer_id?: number;
  target_department?: string;
  snapshot_json?: string;
  outcome?: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  duration_ms?: number;
  browser?: string;
  os?: string;
  device_type?: string;
  is_new_ip?: boolean;
  is_new_device?: boolean;
  ip_address?: string;
  user_agent?: string;
  request_url?: string;
  changes_count?: number;
  changes?: SystemAuditChange[];
}

export interface SystemAuditStats {
  period: string;
  create_count: number;
  update_count: number;
  delete_count: number;
  ai_check_count: number;
  login_count: number;
  failed_login_count: number;
}

export const getSystemAuditStats = (params?: { period?: string; start_date?: string; end_date?: string }) =>
  api.get<SystemAuditStats>('/system-audit/stats', { params }).then(r => r.data);

export const getSystemAuditLogs = (params?: {
  business_unit?: string;
  project_id?: number;
  module?: string;
  action?: string;
  severity?: string;
  login_method?: string;
  source?: string;
  category?: string;
  ip_risk?: string;
  outcome?: string;
  session_id?: string;
  correlation_id?: string;
  target_user_id?: number;
  user_id?: number;
  search?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}) => api.get<{ total: number; page: number; page_size: number; total_pages: number; items: SystemAuditItem[] }>('/system-audit/logs', { params }).then(r => r.data);

export const exportSystemAuditLogs = (params?: {
  business_unit?: string;
  project_id?: number;
  module?: string;
  action?: string;
  severity?: string;
  login_method?: string;
  source?: string;
  category?: string;
  ip_risk?: string;
  user_id?: number;
  search?: string;
  start_date?: string;
  end_date?: string;
}) => api.get('/system-audit/export', { params, responseType: 'blob' }).then(r => r.data);

export const exportSystemAuditLogsJSON = (params?: {
  search?: string;
  category?: string;
  source?: string;
}) => api.get('/system-audit/export-json', { params, responseType: 'blob' }).then(r => r.data);

export const getSessionTimeline = (sessionId: string) =>
  api.get<{ session_id: string; total_events: number; events: SystemAuditItem[] }>(`/system-audit/session-timeline/${sessionId}`).then(r => r.data);

export const getSystemAuditAnalytics = () =>
  api.get('/system-audit/analytics').then(r => r.data);

// ── System Audit → Team Comparison (Section 2 & 3) ─────────────
// Strictly super_admin — the backend router already enforces this.
export interface TeamComparisonMember {
  member_id: number;
  name: string;
  position?: string | null;
  department?: string | null;
  team?: string | null;
  assigned: number;
  support: number;
  total: number;
  done: number;
  in_progress: number;
  overdue: number;
  manday_est: number;
  manday_actual: number;
  kpi: number;
  progress_pct: number;
  // KPI% for workload classification (from Done tasks in selected period)
  period_kpi: number;
  kpi_pct: number;
}
export interface TeamComparisonProject {
  project_id: number;
  name: string;
  status?: string | null;
  current_phase?: string | null;
  data_scope?: string | null;
  business?: string | null;
  workspace?: string | null;
  total: number;
  done: number;
  in_progress: number;
  overdue: number;
  manday_est: number;
  manday_actual: number;
  kpi: number;
  // Issue 3 — configured Project Progress from Settings → Master Phases.
  // Replaces the previous task-based calculation as the source of truth.
  progress_pct: number;
  // Kept for surfaces that intentionally show task-completion separately.
  task_completion_pct?: number;
  timeline_pct: number;
  health: 'On Track' | 'Risk' | 'Critical' | 'N/A' | string;
}
export interface TeamComparisonTeam {
  leader_user_id: number;
  leader_member_id: number;
  leader_name: string;
  leader_email: string;
  team_name: string;
  workspace: string;
  data_scope: string;
  member_count: number;
  members: TeamComparisonMember[];
  kpi: number;
  plan_md: number;
  actual_md: number;
  util: number;
  efficiency: number;
  on_time: number;
  overdue: number;
  total: number;
  done: number;
  in_progress: number;
  health: 'On Track' | 'Risk' | 'Critical' | 'N/A' | string;
  projects: TeamComparisonProject[];
  // Leader's individual workload KPI (own tasks only, NOT team aggregate)
  leader_period_kpi: number;
  leader_kpi_pct: number;
  // Leader's personal task aggregates (own tasks only, NOT team)
  leader_done: number;
  leader_doing: number;
  leader_overdue: number;
  leader_kpi: number;
  leader_manday_est: number;
  leader_manday_actual: number;
}
export interface WorkloadSetting {
  status_key: string;
  status_label: string;
  min_kpi: number | null;
  max_kpi: number | null;
}
export interface TeamComparisonResponse {
  workspace: string;
  workspace_filter: string;
  teams: TeamComparisonTeam[];
  weeks_divisor: number;
  workload_settings: WorkloadSetting[];
}
export const getTeamComparison = (params?: { workspace?: string; start_date?: string; end_date?: string }) =>
  api.get<TeamComparisonResponse>('/system-audit/team-comparison', { params }).then(r => r.data);
export const getTeamDetail = (
  leader_user_id: number,
  params?: { start_date?: string; end_date?: string },
) =>
  api.get<{ team: TeamComparisonTeam }>('/system-audit/team-detail', {
    params: { leader_user_id, ...(params || {}) },
  }).then(r => r.data);

// ── Workload Settings (Super Admin only) ─────────────────────
export const getWorkloadSettings = () =>
  api.get<WorkloadSetting[]>('/workload-settings').then(r => r.data);
export const updateWorkloadSettings = (settings: Partial<WorkloadSetting>[]) =>
  api.put<{ success: boolean; data: WorkloadSetting[] }>('/workload-settings', settings).then(r => r.data);

// Telegram connection (Leave Request notifications)
export interface TelegramStatus {
  connected: boolean;
  enabled: boolean;
}
export const getTelegramStatus = () =>
  api.get<TelegramStatus>('/telegram/status').then(r => r.data);
export const generateTelegramConnectUrl = () =>
  api.post<{ url: string }>('/telegram/connect').then(r => r.data);
export const disconnectTelegram = () =>
  api.post<{ connected: boolean }>('/telegram/disconnect').then(r => r.data);

// Zalo account (task-assignment chat integration)
export interface ZaloAccountStatus {
  connected: boolean;
  account: { id: number; label: string; status: string; last_login_at: string | null } | null;
  worker: { logged_in: boolean; listener_connected: boolean; configured: boolean };
}
export interface ZaloConversation {
  id: number;
  thread_id: string;
  name: string;
  is_group: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  project_id: number | null;
  project_name: string | null;
}
export interface ZaloMessage {
  id: number;
  source_message_id: string;
  sender_zalo_id: string | null;
  sender_name: string | null;
  content: string | null;
  is_outgoing: boolean;
  created_at: string;
}
export const getZaloStatus = () =>
  api.get<ZaloAccountStatus>('/zalo/status').then(r => r.data);
export const importZaloSession = (payload: { cookies: unknown[]; imei: string; user_agent: string }) =>
  api.post<{ connected: boolean; account_id: number }>('/zalo/auth/import-session', payload).then(r => r.data);
export const disconnectZalo = () =>
  api.post<{ connected: boolean }>('/zalo/disconnect').then(r => r.data);
export const getZaloConversations = () =>
  api.get<ZaloConversation[]>('/zalo/conversations').then(r => r.data);
export interface ZaloAvailableGroup { thread_id: string; name: string; already_tracked: boolean }
export const getZaloAvailableGroups = () =>
  api.get<ZaloAvailableGroup[]>('/zalo/groups/available').then(r => r.data);
export const getZaloConversationMessages = (conversationId: number, afterId?: number) =>
  api.get<ZaloMessage[]>(`/zalo/conversations/${conversationId}/messages`, { params: { after_id: afterId } }).then(r => r.data);
export interface ZaloRecommendedTask {
  detail_task: string;
  priority: string;
  assigned_name: string;
  deadline: string;
}
export interface ZaloConversationSummary {
  id: number;
  period_start: string;
  period_end: string;
  message_count: number;
  content: string;
  decisions: string[];
  issues: string[];
  next_steps: string[];
  recommended_tasks: ZaloRecommendedTask[];
  created_at: string;
}
export const getZaloConversationSummaries = (conversationId: number) =>
  api.get<ZaloConversationSummary[]>(`/zalo/conversations/${conversationId}/summaries`).then(r => r.data);
export const summarizeZaloConversationNow = (conversationId: number) =>
  api.post<ZaloConversationSummary>(`/zalo/conversations/${conversationId}/summarize-now`).then(r => r.data);
export interface ZaloProjectGroupSummary {
  conversation_id: number;
  name: string;
  last_message_at: string | null;
  summaries: ZaloConversationSummary[];
}
export const getProjectZaloSummary = (projectId: number) =>
  api.get<ZaloProjectGroupSummary[]>(`/zalo/projects/${projectId}/summary`).then(r => r.data);
export interface ZaloOutgoingMention { uid: string; pos: number; len: number }
export const sendZaloMessage = (conversationId: number, text: string, mentions?: ZaloOutgoingMention[]) =>
  api.post<{ ok: boolean; source_message_id: string }>(`/zalo/conversations/${conversationId}/send`, { text, mentions }).then(r => r.data);
export const sendZaloMessageToThread = (payload: { thread_id: string; text: string; is_group: boolean; name?: string }) =>
  api.post<{ ok: boolean; conversation_id: number; source_message_id: string }>('/zalo/conversations/send-to-thread', payload).then(r => r.data);
export const refreshZaloConversationNames = () =>
  api.post<{ updated: number; checked: number }>('/zalo/conversations/refresh-names').then(r => r.data);
export interface ZaloSuggestedMember {
  zalo_name: string;
  zalo_uid: string | null;
  linked: boolean;
  member_id: number | null;
  member_full_name: string | null;
}
export const getZaloSuggestedMentions = (conversationId: number) =>
  api.get<{ members: ZaloSuggestedMember[]; total_member: number }>(
    `/zalo/conversations/${conversationId}/suggested-members`
  ).then(r => r.data);
export const remindUnlinkedZaloMember = (conversationId: number, zaloName: string) =>
  api.post<{ ok: boolean }>(`/zalo/conversations/${conversationId}/remind-unlinked`, { zalo_name: zaloName }).then(r => r.data);
export interface ZaloProjectMember {
  id: number;
  full_name: string;
  display_name: string;
  zalo_name: string | null;
  zalo_uid: string | null;
}
export const getZaloProjectMembers = (conversationId: number) =>
  api.get<ZaloProjectMember[]>(`/zalo/conversations/${conversationId}/project-members`).then(r => r.data);
export const createZaloTaskFromConversation = (
  conversationId: number,
  payload: { title: string; assigned_member_id: number; priority: string; manday: number; deadline?: string }
) =>
  api.post<{
    id: number; task_code: string; detail: string; manday_est: number; assigned_id: number;
    end_date_est: string | null; zalo_notify_error: string | null;
  }>(
    `/zalo/conversations/${conversationId}/create-task`,
    payload
  ).then(r => r.data);
export interface ZaloProjectTask {
  id: number;
  task_code: string;
  detail: string;
  priority: string;
  status: string;
  manday_est: number | null;
  start_date: string | null;
  end_date_actual: string | null;
  assigned_id: number;
  assigned_name: string;
  assigned_zalo_uid: string | null;
  assigned_zalo_name: string;
  last_demo_requested_at: string | null;
  zalo_demo_skip: boolean;
}
export type ZaloTaskStatusFilter = 'done' | 'assigned' | 'all';
export type ZaloTaskRangeFilter = 'today' | 'yesterday' | '7d' | 'all';
export const getZaloProjectTasks = (conversationId: number, status: ZaloTaskStatusFilter, range: ZaloTaskRangeFilter) =>
  api.get<ZaloProjectTask[]>(`/zalo/conversations/${conversationId}/tasks`, { params: { status, range } }).then(r => r.data);
export const requestZaloDemo = (conversationId: number, payload: { task_id: number; demo_at: string }) =>
  api.post<{ ok: boolean }>(`/zalo/conversations/${conversationId}/request-demo`, payload).then(r => r.data);
export const setZaloDemoSkip = (conversationId: number, taskId: number, skip: boolean) =>
  api.post<{ ok: boolean; zalo_demo_skip: boolean }>(`/zalo/conversations/${conversationId}/tasks/${taskId}/skip-demo`, { skip }).then(r => r.data);
export const linkZaloConversationToProject = (conversationId: number, projectId: number | null) =>
  api.post<{ conversation_id: number; project_id: number | null }>(
    `/zalo/conversations/${conversationId}/link-project`,
    { project_id: projectId }
  ).then(r => r.data);

// Notifications
export const remindLeader = (taskId: number, message?: string) =>
  api.post('/notifications/remind', { task_id: taskId, message }).then(r => r.data);

export const remindLeaderBulk = (projectId?: number) =>
  api.post('/notifications/remind-bulk', { project_id: projectId }).then(r => r.data);

export const getMyAlerts = () =>
  api.get('/notifications/my-alerts').then(r => r.data);

export const remindTaskGroup = (taskGroupId: number, message?: string) =>
  api.post('/notifications/remind-group', { task_group_id: taskGroupId, message }).then(r => r.data);

export interface InboxNotificationItem {
  id: number;
  sender_id: number | null;
  sender_name: string;
  project_id: number | null;
  project_name: string | null;
  task_group_id: number | null;
  group_name: string | null;
  task_id: number | null;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string | null;
  zalo_conversation_id: number | null;
  zalo_conversation_name: string | null;
}
export const getInboxNotifications = () =>
  api.get<{ unread_count: number; items: InboxNotificationItem[] }>('/notifications/inbox').then(r => r.data);

export const markNotificationRead = (id: number) =>
  api.patch(`/notifications/${id}/read`).then(r => r.data);
