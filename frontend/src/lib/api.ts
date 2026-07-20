import axios from 'axios';
import { getToken, logout } from './auth';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
const api = axios.create({ baseURL: BASE });

api.interceptors.request.use(cfg => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) logout();
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
}

export const getAuthConfig = () => api.get<AuthConfig>('/auth/config').then(r => r.data);
export const googleLogin = (credential: string) =>
  api.post('/auth/google', { credential }).then(r => r.data);

// ═══════════════════════════════════════════════════════════
// PROJECTS (v5)
// ═══════════════════════════════════════════════════════════
export const getProjects = () => api.get('/projects').then(r => r.data);
export const getProject = (id: number) => api.get(`/projects/${id}`).then(r => r.data);
export const createProject = (data: object) => api.post('/projects', data).then(r => r.data);
export const updateProject = (id: number, data: object) => api.patch(`/projects/${id}`, data).then(r => r.data);
export const deleteProject = (id: number) => api.delete(`/projects/${id}`).then(r => r.data);

// Project Members
export const getProjectMembers = (pid: number) => api.get(`/projects/${pid}/members`).then(r => r.data);
export const addProjectMember = (pid: number, memberId: number, role?: string) =>
  api.post(`/projects/${pid}/members`, { member_id: memberId, role: role || 'Member' }).then(r => r.data);
export const removeProjectMember = (pid: number, memberId: number) =>
  api.delete(`/projects/${pid}/members/${memberId}`).then(r => r.data);

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

// Members
export const getMembers = (params?: { search?: string; team?: string; position?: string; department?: string; skill_id?: number }) =>
  api.get('/members', { params }).then(r => r.data);
export const getMember = (id: number) => api.get(`/members/${id}`).then(r => r.data);
export const createMember = (data: object) => api.post('/members', data).then(r => r.data);
export const updateMember = (id: number, data: object) => api.put(`/members/${id}`, data).then(r => r.data);
export const deleteMember = (id: number) => api.delete(`/members/${id}`).then(r => r.data);

// Customers
export const getCustomers = () => api.get('/system-categories/customers').then(r => r.data);
export const createCustomer = (data: { name: string; description?: string }) => api.post('/system-categories/customers', data).then(r => r.data);
export const updateCustomer = (id: number, data: { name: string; description?: string }) => api.put(`/system-categories/customers/${id}`, data).then(r => r.data);
export const deleteCustomer = (id: number) => api.delete(`/system-categories/customers/${id}`).then(r => r.data);

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
export const getMeetings = (params?: { project_id?: number; status?: string; from_date?: string; to_date?: string }) =>
  api.get('/meetings', { params }).then(r => r.data);
export const getMeeting = (id: number) => api.get(`/meetings/${id}`).then(r => r.data);
export const createMeeting = (data: object) => api.post('/meetings', data).then(r => r.data);
export const updateMeeting = (id: number, data: object) => api.put(`/meetings/${id}`, data).then(r => r.data);
export const deleteMeeting = (id: number) => api.delete(`/meetings/${id}`).then(r => r.data);
export const updateTranscript = (id: number, transcript: string) => api.post(`/meetings/${id}/transcript`, { transcript }).then(r => r.data);
export const addMeetingMember = (id: number, memberId: number, role?: string) => api.post(`/meetings/${id}/members`, { member_id: memberId, role }).then(r => r.data);
export const removeMeetingMember = (id: number, memberId: number) => api.delete(`/meetings/${id}/members/${memberId}`).then(r => r.data);
export const syncMeeting = (id: number) => api.post(`/meetings/${id}/sync`).then(r => r.data);
export const getGoogleStatus = () => api.get('/meetings/google/status').then(r => r.data);
export const getGoogleAuthUrl = () => api.get('/meetings/google/auth').then(r => r.data);


// Performance Settings CRUD
export const getPerformanceSettings = () => api.get('/performance-settings').then(r => r.data);
export const createPerformanceSetting = (data: { performance: string; kpi: number; sort_order?: number; is_active?: boolean }) => api.post('/performance-settings', data).then(r => r.data);
export const updatePerformanceSetting = (id: number, data: { performance?: string; kpi?: number; sort_order?: number; is_active?: boolean }) => api.put(`/performance-settings/${id}`, data).then(r => r.data);
export const deletePerformanceSetting = (id: number) => api.delete(`/performance-settings/${id}`).then(r => r.data);

// Accounts Management
export const getAccounts = () => api.get('/accounts').then(r => r.data);
export const getAvailableMembers = () => api.get('/accounts/available-members').then(r => r.data);
export const createAccount = (data: { email: string; password?: string; role: string; data_scope: string; full_name?: string; member_id?: number }) => api.post('/accounts', data).then(r => r.data);
export const updateAccount = (id: number, data: { email?: string; full_name?: string; role?: string; data_scope?: string }) => api.put(`/accounts/${id}`, data).then(r => r.data);
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

export const triggerAIReview = (entityType: string, entityId: number) =>
  api.post('/ai-review/check', { entity_type: entityType, entity_id: entityId }).then(r => r.data);

export const getAIReviewHistory = (entityType: string, entityId: number) =>
  api.get('/ai-review/history', { params: { entity_type: entityType, entity_id: entityId } }).then(r => r.data);

export const getAIReviewLog = (logId: number) =>
  api.get(`/ai-review/logs/${logId}`).then(r => r.data);
