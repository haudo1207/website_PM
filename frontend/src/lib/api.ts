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

export const login = (e: string, p: string) =>
  api.post('/auth/login', new URLSearchParams({ username: e, password: p }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }).then(r => r.data);

export const getSheets = () => api.get('/sheets').then(r => r.data);
export const addSheet = (data: {
  url?: string;
  name: string;
  leader_email?: string;
  pm_email?: string;
  member_emails?: string;
  project_code?: string;
  customer_name?: string;
  current_phase?: string;
  auto_create?: boolean;
  zalo_link?: string;
  telegram_link?: string;
  teams_link?: string;
}) => api.post('/sheets', data).then(r => r.data);
export const getWorksheets = (url: string) =>
  api.post('/sheets/worksheets', { url }).then(r => r.data);



export const deleteSheet = (id: number) => api.delete(`/sheets/${id}`);
export const updateSheet = (id: number, data: object) => api.put(`/sheets/${id}`, data).then(r => r.data);
export const checkSheet = (id: number) => api.post(`/sheets/${id}/check`).then(r => r.data);
export const getSheetLogs = (id: number) => api.get(`/sheets/${id}/logs`).then(r => r.data);
export const addTask = (sheetId: number, data: { tab_name: string; after_row: number; task_data: object }) => api.post(`/sheets/${sheetId}/add-task`, data).then(r => r.data);
export const getViolations = (params?: object) => api.get('/violations', { params }).then(r => r.data);
export const checkSingleTask = (id: number) => api.post(`/violations/${id}/check`).then(r => r.data);
export const getColumnConfig = () => api.get('/settings/column-config').then(r => r.data);
export const updateColumnConfig = (d: object) => api.put('/settings/column-config', d).then(r => r.data);
export const getPolicy = () => api.get('/settings/policy').then(r => r.data);
export const updatePolicy = (d: object) => api.put('/settings/policy', d).then(r => r.data);
export const getAuditLog = () => api.get('/settings/audit-log').then(r => r.data);
export const getAIConfig = () => api.get('/settings/ai-config').then(r => r.data);
export const updateAIConfig = (d: object) => api.put('/settings/ai-config', d).then(r => r.data);
export const getAIModels = () => api.get('/settings/ai-models').then(r => r.data);
export const getUsers = () => api.get('/users').then(r => r.data);
export const createUser = (d: object) => api.post('/users', d).then(r => r.data);
export const updateUser = (id: number, d: object) => api.put(`/users/${id}`, d).then(r => r.data);
export const deleteUser = (id: number) => api.delete(`/users/${id}`);

export const getChatGroups = (sheetId: number) => api.get(`/sheets/${sheetId}/chat-groups`).then(r => r.data);
export const createChatGroup = (sheetId: number, d: { name: string; platform: string; link: string; desc?: string }) => api.post(`/sheets/${sheetId}/chat-groups`, d).then(r => r.data);
export const deleteChatGroup = (sheetId: number, cgid: number) => api.delete(`/sheets/${sheetId}/chat-groups/${cgid}`).then(r => r.data);


