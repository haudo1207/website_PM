import React, { useState, useEffect } from 'react';
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createTeam,
  updateTeam,
  deleteTeam,
  getMasterPhases,
  createMasterPhase,
  updateMasterPhase,
  reorderMasterPhases,
  deleteMasterPhase,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace
} from '@/lib/api';

const N8N_SECRET_MIN_LENGTH = 16;

// 32 random bytes → 43-char base64url string (no padding).
const generateWebhookSecret = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Shared input for the per-workspace n8n webhook secret (create + edit). The
// stored secret is never returned by the API, so in edit mode an empty input
// means "keep current".
function N8nSecretField({
  value,
  onChange,
  isEdit,
  hasSecret,
  clearPending,
  onToggleClear,
  onFlash,
}: {
  value: string;
  onChange: (v: string) => void;
  isEdit?: boolean;
  hasSecret?: boolean;
  clearPending?: boolean;
  onToggleClear?: () => void;
  onFlash: (msg: string) => void;
}) {
  const tooShort = value.length > 0 && value.length < N8N_SECRET_MIN_LENGTH;
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      onFlash('Đã sao chép secret webhook n8n');
    } catch {
      onFlash('Không thể sao chép — vui lòng sao chép thủ công');
    }
  };
  return (
    <div className="flex-1 flex flex-col gap-1.5">
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
        Secret webhook n8n (gửi về)
        {isEdit && hasSecret && !clearPending && (
          <span className="normal-case tracking-normal text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-bold">Đã đặt</span>
        )}
        {isEdit && clearPending && (
          <span className="normal-case tracking-normal text-[10px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded font-bold">Sẽ xóa khi lưu</span>
        )}
      </label>
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="new-password"
          placeholder={isEdit && hasSecret ? 'Để trống = giữ secret hiện tại' : `Tối thiểu ${N8N_SECRET_MIN_LENGTH} ký tự`}
          value={value}
          disabled={clearPending}
          onChange={e => onChange(e.target.value)}
          className={`bg-white border rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500 flex-1 min-w-0 disabled:bg-slate-100 ${tooShort ? 'border-red-400' : 'border-slate-200'}`}
        />
        <button
          type="button"
          disabled={clearPending}
          onClick={() => onChange(generateWebhookSecret())}
          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg font-semibold shrink-0 disabled:opacity-50"
        >
          Tạo ngẫu nhiên
        </button>
        <button
          type="button"
          disabled={!value || clearPending}
          onClick={handleCopy}
          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg font-semibold shrink-0 disabled:opacity-50"
        >
          Sao chép
        </button>
        {isEdit && hasSecret && onToggleClear && (
          <button
            type="button"
            onClick={onToggleClear}
            className={`text-xs px-2.5 py-1 rounded-lg font-semibold shrink-0 border ${clearPending ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200'}`}
          >
            {clearPending ? 'Hủy xóa' : 'Xóa secret'}
          </button>
        )}
      </div>
      {tooShort && (
        <p className="text-[10px] text-red-500 font-semibold">Secret phải có ít nhất {N8N_SECRET_MIN_LENGTH} ký tự.</p>
      )}
      <p className="text-[10px] text-slate-400">
        n8n gửi giá trị này trong header <span className="font-mono">X-N8N-Webhook-Secret</span> khi đẩy biên bản họp về cho Workspace này.
      </p>
    </div>
  );
}

interface SystemCategoriesViewProps {
  departments: any[]; // Teams (Infrastructure, Markee, PMO, AI, HR)
  teams: any[];       // Levels (Intern, Fresher, Junior, Middle, Senior, Leader, PM)
  workspaces: any[];  // Workspaces (INFRA, DEV, ...)
  onReload: () => void;
  onFlash: (msg: string) => void;
}

export default function SystemCategoriesView({
  departments,
  teams,
  workspaces,
  onReload,
  onFlash
}: SystemCategoriesViewProps) {
  const [activeTab, setActiveTab] = useState<'teams' | 'levels' | 'phases' | 'workspaces'>('teams');

  // 1. TEAM STATES (formerly Departments)
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [editingTeamDesc, setEditingTeamDesc] = useState('');

  // 2. LEVEL STATES (formerly Teams)
  const [showAddLevel, setShowAddLevel] = useState(false);
  const [newLevelName, setNewLevelName] = useState('');
  const [newLevelDesc, setNewLevelDesc] = useState('');
  const [editingLevelId, setEditingLevelId] = useState<number | null>(null);
  const [editingLevelName, setEditingLevelName] = useState('');
  const [editingLevelDesc, setEditingLevelDesc] = useState('');

  // 3. MASTER PHASES STATES
  const [masterPhases, setMasterPhases] = useState<any[]>([]);
  const [showAddPhase, setShowAddPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [newPhaseDesc, setNewPhaseDesc] = useState('');
  const [editingPhaseId, setEditingPhaseId] = useState<number | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [editingPhaseDesc, setEditingPhaseDesc] = useState('');

  // 4. WORKSPACE STATES
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsCode, setNewWsCode] = useState('');
  const [newWsDesc, setNewWsDesc] = useState('');
  const [newWsWebhook, setNewWsWebhook] = useState('');
  const [newWsExpectedEmail, setNewWsExpectedEmail] = useState('');
  const [editingWsId, setEditingWsId] = useState<number | null>(null);
  const [editingWsName, setEditingWsName] = useState('');
  const [editingWsCode, setEditingWsCode] = useState('');
  const [editingWsDesc, setEditingWsDesc] = useState('');
  const [editingWsWebhook, setEditingWsWebhook] = useState('');
  const [editingWsExpectedEmail, setEditingWsExpectedEmail] = useState('');
  const [newWsSecret, setNewWsSecret] = useState('');
  const [editingWsSecret, setEditingWsSecret] = useState('');
  const [editingWsClearSecret, setEditingWsClearSecret] = useState(false);

  useEffect(() => {
    loadMasterPhases();
  }, []);

  const loadMasterPhases = () => {
    getMasterPhases()
      .then(setMasterPhases)
      .catch(() => {});
  };

  // --- HANDLERS: TEAM ---
  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    try {
      await createDepartment({ name: newTeamName, description: newTeamDesc });
      setNewTeamName('');
      setNewTeamDesc('');
      setShowAddTeam(false);
      onReload();
      onFlash('Đã thêm Team mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm Team');
    }
  };

  const handleUpdateTeam = async (id: number) => {
    if (!editingTeamName.trim()) return;
    try {
      await updateDepartment(id, { name: editingTeamName, description: editingTeamDesc });
      setEditingTeamId(null);
      onReload();
      onFlash('Đã cập nhật Team thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật Team');
    }
  };

  const handleDeleteTeam = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa Team "${name}"?`)) return;
    try {
      await deleteDepartment(id);
      onReload();
      onFlash('Đã xóa Team thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa Team');
    }
  };

  // --- HANDLERS: LEVEL ---
  const handleAddLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLevelName.trim()) return;
    try {
      await createTeam({ name: newLevelName, description: newLevelDesc });
      setNewLevelName('');
      setNewLevelDesc('');
      setShowAddLevel(false);
      onReload();
      onFlash('Đã thêm Level cấp bậc mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm Level');
    }
  };

  const handleUpdateLevel = async (id: number) => {
    if (!editingLevelName.trim()) return;
    try {
      await updateTeam(id, { name: editingLevelName, description: editingLevelDesc });
      setEditingLevelId(null);
      onReload();
      onFlash('Đã cập nhật Level cấp bậc thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật Level');
    }
  };

  const handleDeleteLevel = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa Level "${name}"?`)) return;
    try {
      await deleteTeam(id);
      onReload();
      onFlash('Đã xóa Level thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa Level');
    }
  };

  // --- HANDLERS: MASTER PHASES ---
  const handleAddPhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhaseName.trim()) return;
    try {
      await createMasterPhase({ name: newPhaseName, description: newPhaseDesc });
      setNewPhaseName('');
      setNewPhaseDesc('');
      setShowAddPhase(false);
      loadMasterPhases();
      onFlash('Đã thêm giai đoạn dự án chuẩn thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm giai đoạn master');
    }
  };

  const handleUpdatePhase = async (id: number) => {
    if (!editingPhaseName.trim()) return;
    try {
      await updateMasterPhase(id, { name: editingPhaseName, description: editingPhaseDesc });
      setEditingPhaseId(null);
      loadMasterPhases();
      onFlash('Đã cập nhật giai đoạn dự án thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật giai đoạn');
    }
  };

  const handleDeletePhase = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa giai đoạn "${name}"?`)) return;
    try {
      await deleteMasterPhase(id);
      loadMasterPhases();
      onFlash('Đã xóa giai đoạn dự án thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa giai đoạn');
    }
  };

  const handleMovePhase = async (index: number, direction: 'up' | 'down') => {
    const newItems = [...masterPhases];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newItems.length) return;

    const temp = newItems[index];
    newItems[index] = newItems[targetIdx];
    newItems[targetIdx] = temp;
    setMasterPhases(newItems);

    try {
      await reorderMasterPhases(newItems.map(x => x.id));
      onFlash('Đã cập nhật thứ tự giai đoạn');
    } catch (err) {
      onFlash('Lỗi cập nhật thứ tự giai đoạn');
      loadMasterPhases();
    }
  };

  // --- HANDLERS: WORKSPACES ---
  const handleAddWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim() || !newWsCode.trim()) return;
    const secret = newWsSecret.trim();
    if (secret && secret.length < N8N_SECRET_MIN_LENGTH) {
      onFlash(`Secret webhook n8n phải có ít nhất ${N8N_SECRET_MIN_LENGTH} ký tự`);
      return;
    }
    try {
      await createWorkspace({
        name: newWsName, code: newWsCode, description: newWsDesc, n8n_webhook_url: newWsWebhook, expected_google_email: newWsExpectedEmail,
        ...(secret ? { n8n_webhook_secret: secret } : {}),
      });
      setNewWsName('');
      setNewWsCode('');
      setNewWsDesc('');
      setNewWsWebhook('');
      setNewWsExpectedEmail('');
      setNewWsSecret('');
      setShowAddWorkspace(false);
      onReload();
      onFlash('Đã thêm Workspace mới thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi thêm Workspace');
    }
  };

  const handleUpdateWorkspace = async (id: number) => {
    if (!editingWsName.trim() || !editingWsCode.trim()) return;
    const secret = editingWsSecret.trim();
    if (!editingWsClearSecret && secret && secret.length < N8N_SECRET_MIN_LENGTH) {
      onFlash(`Secret webhook n8n phải có ít nhất ${N8N_SECRET_MIN_LENGTH} ký tự`);
      return;
    }
    try {
      await updateWorkspace(id, {
        name: editingWsName, code: editingWsCode, description: editingWsDesc, n8n_webhook_url: editingWsWebhook, expected_google_email: editingWsExpectedEmail,
        // Empty input = keep the current secret (omit both fields).
        ...(editingWsClearSecret ? { clear_n8n_webhook_secret: true } : secret ? { n8n_webhook_secret: secret } : {}),
      });
      setEditingWsId(null);
      setEditingWsSecret('');
      setEditingWsClearSecret(false);
      onReload();
      onFlash('Đã cập nhật Workspace thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi cập nhật Workspace');
    }
  };

  const handleDeleteWorkspace = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa Workspace "${name}"?`)) return;
    try {
      await deleteWorkspace(id);
      onReload();
      onFlash('Đã xóa Workspace thành công');
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa Workspace');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">DANH MỤC HỆ THỐNG</h1>
        <p className="text-sm text-slate-500 mt-1">Quản lý các dữ liệu dùng chung của hệ thống: Team, Level cấp bậc, Giai đoạn dự án master và Workspace</p>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-fit max-w-full overflow-x-auto">
        <button
          onClick={() => setActiveTab('teams')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
            activeTab === 'teams'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          🏢 Team
        </button>
        <button
          onClick={() => setActiveTab('levels')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
            activeTab === 'levels'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          💼 Level
        </button>
        <button
          onClick={() => setActiveTab('phases')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
            activeTab === 'phases'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          🚩 Giai đoạn dự án
        </button>
        <button
          onClick={() => setActiveTab('workspaces')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
            activeTab === 'workspaces'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          🗂️ Workspace
        </button>
      </div>

      {/* TAB 1: TEAMS */}
      {activeTab === 'teams' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                🏢 Quản lý Team
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Danh mục các Team chuyên môn (Infrastructure, Markee, PMO, AI, HR,...)</p>
            </div>
            <button
              onClick={() => setShowAddTeam(!showAddTeam)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm"
            >
              {showAddTeam ? 'Đóng' : '+ Thêm Team'}
            </button>
          </div>

          {showAddTeam && (
            <form onSubmit={handleAddTeam} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên Team <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: Infrastructure, Markee, PMO, AI, HR..."
                  value={newTeamName}
                  onChange={e => setNewTeamName(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
                <input
                  type="text"
                  placeholder="Mô tả ngắn về công việc của Team..."
                  value={newTeamDesc}
                  onChange={e => setNewTeamDesc(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0"
              >
                Lưu Team
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {departments.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Chưa có Team nào được khởi tạo.</div>
            ) : (
              departments.map(dept => (
                <div key={dept.id} className="p-4 px-6 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                  {editingTeamId === dept.id ? (
                    <div className="flex-1 flex flex-col md:flex-row gap-3 items-center">
                      <input
                        type="text"
                        value={editingTeamName}
                        onChange={e => setEditingTeamName(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a]"
                      />
                      <input
                        type="text"
                        value={editingTeamDesc}
                        onChange={e => setEditingTeamDesc(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] flex-1"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdateTeam(dept.id)} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded font-semibold">Lưu</button>
                        <button onClick={() => setEditingTeamId(null)} className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-semibold">Hủy</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="text-xs font-bold text-[#0f172a]">{dept.name}</div>
                        {dept.description && <div className="text-[11px] text-slate-500 mt-0.5">{dept.description}</div>}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setEditingTeamId(dept.id);
                            setEditingTeamName(dept.name);
                            setEditingTeamDesc(dept.description || '');
                          }}
                          className="text-xs text-blue-600 hover:underline font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeleteTeam(dept.id, dept.name)}
                          className="text-xs text-red-600 hover:underline font-semibold"
                        >
                          Xóa
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: LEVELS (formerly Teams) */}
      {activeTab === 'levels' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                💼 Level
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Danh mục các cấp bậc chuyên môn (Intern, Fresher, Junior, Middle, Senior, Leader, PM)</p>
            </div>
            <button
              onClick={() => setShowAddLevel(!showAddLevel)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm"
            >
              {showAddLevel ? 'Đóng' : '+ Thêm Level'}
            </button>
          </div>

          {showAddLevel && (
            <form onSubmit={handleAddLevel} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên Level <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: Intern, Fresher, Junior, Middle, Senior, Leader, PM..."
                  value={newLevelName}
                  onChange={e => setNewLevelName(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
                <input
                  type="text"
                  placeholder="Mô tả cấp bậc..."
                  value={newLevelDesc}
                  onChange={e => setNewLevelDesc(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0"
              >
                Lưu Level
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {teams.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Chưa có Level cấp bậc nào được tạo.</div>
            ) : (
              teams.map(t => (
                <div key={t.id} className="p-4 px-6 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                  {editingLevelId === t.id ? (
                    <div className="flex-1 flex flex-col md:flex-row gap-3 items-center">
                      <input
                        type="text"
                        value={editingLevelName}
                        onChange={e => setEditingLevelName(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a]"
                      />
                      <input
                        type="text"
                        value={editingLevelDesc}
                        onChange={e => setEditingLevelDesc(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] flex-1"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdateLevel(t.id)} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded font-semibold">Lưu</button>
                        <button onClick={() => setEditingLevelId(null)} className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-semibold">Hủy</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="text-xs font-bold text-[#0f172a]">{t.name}</div>
                        {t.description && <div className="text-[11px] text-slate-500 mt-0.5">{t.description}</div>}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setEditingLevelId(t.id);
                            setEditingLevelName(t.name);
                            setEditingLevelDesc(t.description || '');
                          }}
                          className="text-xs text-blue-600 hover:underline font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeleteLevel(t.id, t.name)}
                          className="text-xs text-red-600 hover:underline font-semibold"
                        >
                          Xóa
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: GIAI ĐOẠN DỰ ÁN (MASTER PHASES) */}
      {activeTab === 'phases' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                🚩 Quản lý Giai đoạn Dự án (Master Phases)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Cấu hình danh mục Phase chuẩn master cho toàn bộ dự án mới (Khảo sát, Phân tích yêu cầu, ..., Bảo trì)</p>
            </div>
            <button
              onClick={() => setShowAddPhase(!showAddPhase)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm"
            >
              {showAddPhase ? 'Đóng' : '+ Thêm Phase'}
            </button>
          </div>

          {showAddPhase && (
            <form onSubmit={handleAddPhase} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên Phase <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  placeholder="Ví dụ: 1. Khảo sát, 2. Phân tích yêu cầu, 3. Thiết kế..."
                  value={newPhaseName}
                  onChange={e => setNewPhaseName(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
                <input
                  type="text"
                  placeholder="Mô tả công việc chuẩn trong phase..."
                  value={newPhaseDesc}
                  onChange={e => setNewPhaseDesc(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0"
              >
                Lưu Phase
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {masterPhases.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Chưa có Giai đoạn master nào. Nhấn "+ Thêm Phase" để tạo giai đoạn chuẩn.</div>
            ) : (
              masterPhases.map((mp, idx) => (
                <div key={mp.id} className="p-4 px-6 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                  {editingPhaseId === mp.id ? (
                    <div className="flex-1 flex flex-col md:flex-row gap-3 items-center">
                      <input
                        type="text"
                        value={editingPhaseName}
                        onChange={e => setEditingPhaseName(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a]"
                      />
                      <input
                        type="text"
                        value={editingPhaseDesc}
                        onChange={e => setEditingPhaseDesc(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] flex-1"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdatePhase(mp.id)} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded font-semibold">Lưu</button>
                        <button onClick={() => setEditingPhaseId(null)} className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-semibold">Hủy</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        {/* Up/Down buttons for ordering */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            disabled={idx === 0}
                            onClick={() => handleMovePhase(idx, 'up')}
                            className="p-1 hover:bg-slate-200 rounded text-[9px] text-slate-600 disabled:opacity-30 cursor-pointer"
                            title="Di chuyển lên"
                          >
                            ▲
                          </button>
                          <button
                            disabled={idx === masterPhases.length - 1}
                            onClick={() => handleMovePhase(idx, 'down')}
                            className="p-1 hover:bg-slate-200 rounded text-[9px] text-slate-600 disabled:opacity-30 cursor-pointer"
                            title="Di chuyển xuống"
                          >
                            ▼
                          </button>
                        </div>

                        <div>
                          <div className="text-xs font-bold text-[#0f172a] flex items-center gap-2">
                            <span className="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-mono font-bold">
                              #{idx + 1}
                            </span>
                            {mp.name}
                          </div>
                          {mp.description && <div className="text-[11px] text-slate-500 mt-0.5">{mp.description}</div>}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setEditingPhaseId(mp.id);
                            setEditingPhaseName(mp.name);
                            setEditingPhaseDesc(mp.description || '');
                          }}
                          className="text-xs text-blue-600 hover:underline font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeletePhase(mp.id, mp.name)}
                          className="text-xs text-red-600 hover:underline font-semibold"
                        >
                          Xóa
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: WORKSPACES (Master Data — Single Source of Truth) */}
      {activeTab === 'workspaces' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                🗂️ Quản lý Workspace (Master Data)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Nguồn dữ liệu duy nhất cho Workspace — dùng cho quyền truy cập dữ liệu, lọc dự án, khách hàng và audit log</p>
            </div>
            <button
              onClick={() => setShowAddWorkspace(!showAddWorkspace)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all shadow-sm"
            >
              {showAddWorkspace ? 'Đóng' : '+ Thêm Workspace'}
            </button>
          </div>

          {showAddWorkspace && (
            <form onSubmit={handleAddWorkspace} className="p-6 bg-slate-50/30 border-b border-slate-200 flex flex-col gap-4">
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên Workspace <span className="text-red-500">*</span></label>
                  <input
                    required
                    type="text"
                    placeholder="Ví dụ: INFRA, DEV..."
                    value={newWsName}
                    onChange={e => setNewWsName(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mã Workspace <span className="text-red-500">*</span></label>
                  <input
                    required
                    type="text"
                    placeholder="Ví dụ: infra, dev (chữ thường, không dấu, không khoảng trắng)"
                    value={newWsCode}
                    onChange={e => setNewWsCode(e.target.value.toLowerCase())}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả (tùy chọn)</label>
                  <input
                    type="text"
                    placeholder="Mô tả workspace..."
                    value={newWsDesc}
                    onChange={e => setNewWsDesc(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0"
                >
                  Lưu Workspace
                </button>
              </div>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Webhook n8n riêng (tùy chọn)</label>
                  <input
                    type="text"
                    placeholder="https://... — để trống thì dùng webhook n8n dùng chung (N8N_MEETING_WEBHOOK_URL_DEFAULT)"
                    value={newWsWebhook}
                    onChange={e => setNewWsWebhook(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email Google dự kiến (tùy chọn)</label>
                  <input
                    type="text"
                    placeholder="vd: devv.szone@gmail.com — chỉ để hiển thị gợi ý trước khi kết nối"
                    value={newWsExpectedEmail}
                    onChange={e => setNewWsExpectedEmail(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <N8nSecretField value={newWsSecret} onChange={setNewWsSecret} onFlash={onFlash} />
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {workspaces.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Chưa có Workspace nào được khởi tạo.</div>
            ) : (
              workspaces.map(w => (
                <div key={w.id} className="p-4 px-6 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                  {editingWsId === w.id ? (
                    <div className="flex-1 flex flex-col gap-3">
                      <div className="flex flex-col md:flex-row gap-3 items-center">
                        <input
                          type="text"
                          value={editingWsName}
                          onChange={e => setEditingWsName(e.target.value)}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a]"
                        />
                        <input
                          type="text"
                          value={editingWsCode}
                          onChange={e => setEditingWsCode(e.target.value.toLowerCase())}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a]"
                        />
                        <input
                          type="text"
                          value={editingWsDesc}
                          onChange={e => setEditingWsDesc(e.target.value)}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] flex-1"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleUpdateWorkspace(w.id)} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded font-semibold">Lưu</button>
                          <button onClick={() => setEditingWsId(null)} className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-semibold">Hủy</button>
                        </div>
                      </div>
                      <div className="flex flex-col md:flex-row gap-3">
                        <input
                          type="text"
                          placeholder="Webhook n8n riêng (tùy chọn) — https://..."
                          value={editingWsWebhook}
                          onChange={e => setEditingWsWebhook(e.target.value)}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] flex-1"
                        />
                        <input
                          type="text"
                          placeholder="Email Google dự kiến (tùy chọn)"
                          value={editingWsExpectedEmail}
                          onChange={e => setEditingWsExpectedEmail(e.target.value)}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-[#0f172a] flex-1"
                        />
                      </div>
                      <N8nSecretField
                        isEdit
                        value={editingWsSecret}
                        onChange={setEditingWsSecret}
                        hasSecret={!!w.has_n8n_webhook_secret}
                        clearPending={editingWsClearSecret}
                        onToggleClear={() => { setEditingWsClearSecret(v => !v); setEditingWsSecret(''); }}
                        onFlash={onFlash}
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="text-xs font-bold text-[#0f172a] flex items-center gap-2">
                          {w.name}
                          <span className="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-mono font-bold">{w.code}</span>
                        </div>
                        {w.description && <div className="text-[11px] text-slate-500 mt-0.5">{w.description}</div>}
                        <div className="text-[11px] mt-0.5">
                          {w.n8n_webhook_url ? (
                            <span className="text-emerald-600 font-semibold">🔗 Webhook n8n riêng: <span className="font-mono">{w.n8n_webhook_url}</span></span>
                          ) : (
                            <span className="text-slate-400">Dùng webhook n8n dùng chung (mặc định)</span>
                          )}
                        </div>
                        <div className="text-[11px] mt-0.5">
                          {w.expected_google_email ? (
                            <span className="text-sky-600 font-semibold">✉️ Email Google dự kiến: <span className="font-mono">{w.expected_google_email}</span></span>
                          ) : (
                            <span className="text-slate-400">Chưa đặt email Google dự kiến</span>
                          )}
                        </div>
                        <div className="text-[11px] mt-0.5">
                          {w.has_n8n_webhook_secret ? (
                            <span className="text-emerald-600 font-semibold">🔒 Secret webhook n8n: Đã đặt</span>
                          ) : (
                            <span className="text-amber-600 font-semibold">⚠️ Chưa đặt secret webhook n8n</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setEditingWsId(w.id);
                            setEditingWsName(w.name);
                            setEditingWsCode(w.code);
                            setEditingWsDesc(w.description || '');
                            setEditingWsWebhook(w.n8n_webhook_url || '');
                            setEditingWsExpectedEmail(w.expected_google_email || '');
                            setEditingWsSecret('');
                            setEditingWsClearSecret(false);
                          }}
                          className="text-xs text-blue-600 hover:underline font-semibold"
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDeleteWorkspace(w.id, w.name)}
                          className="text-xs text-red-600 hover:underline font-semibold"
                        >
                          Xóa
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
