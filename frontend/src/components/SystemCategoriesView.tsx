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
  deleteMasterPhase
} from '@/lib/api';

interface SystemCategoriesViewProps {
  departments: any[]; // Teams (Infrastructure, Markee, PMO, AI, HR)
  teams: any[];       // Levels (Intern, Fresher, Junior, Middle, Senior, Leader, PM)
  onReload: () => void;
  onFlash: (msg: string) => void;
}

export default function SystemCategoriesView({
  departments,
  teams,
  onReload,
  onFlash
}: SystemCategoriesViewProps) {
  const [activeTab, setActiveTab] = useState<'teams' | 'levels' | 'phases'>('teams');

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

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">DANH MỤC HỆ THỐNG</h1>
        <p className="text-sm text-slate-500 mt-1">Quản lý các dữ liệu dùng chung của hệ thống: Team, Level cấp bậc và Giai đoạn dự án master</p>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-fit">
        <button
          onClick={() => setActiveTab('teams')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'teams'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          🏢 Team
        </button>
        <button
          onClick={() => setActiveTab('levels')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'levels'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          💼 Level
        </button>
        <button
          onClick={() => setActiveTab('phases')}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'phases'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          🚩 Giai đoạn dự án
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
    </div>
  );
}
