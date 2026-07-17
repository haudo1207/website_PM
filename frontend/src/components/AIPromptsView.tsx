import React, { useEffect, useState } from 'react';
import { getProjects, getAIPrompts, saveAIPrompt } from '@/lib/api';

interface AIPromptData {
  id?: number;
  project_id: number;
  type: string;
  name: string;
  prompt_content: string;
  active: boolean;
}

interface AIPromptsViewProps {
  onFlash: (msg: string) => void;
}

export default function AIPromptsView({ onFlash }: AIPromptsViewProps) {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<AIPromptData[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [savingPromptId, setSavingPromptId] = useState<string | null>(null);

  // Form states for each prompt type
  const [projectPrompt, setProjectPrompt] = useState<AIPromptData>({ project_id: 0, type: 'PROJECT', name: 'Project Check Prompt', prompt_content: '', active: true });
  const [phasePrompt, setPhasePrompt] = useState<AIPromptData>({ project_id: 0, type: 'PHASE', name: 'Phase Check Prompt', prompt_content: '', active: true });
  const [taskPrompt, setTaskPrompt] = useState<AIPromptData>({ project_id: 0, type: 'TASK', name: 'Task Check Prompt', prompt_content: '', active: true });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const data = await getProjects();
      setProjects(data);
      if (data.length > 0) {
        setSelectedProjectId(data[0].id);
      }
    } catch (err) {
      console.error(err);
      onFlash('Lỗi tải danh sách dự án');
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      loadPrompts(selectedProjectId);
    }
  }, [selectedProjectId]);

  const loadPrompts = async (projectId: number) => {
    setLoadingPrompts(true);
    try {
      const res = await getAIPrompts(projectId);
      if (res.success && res.data) {
        const list: AIPromptData[] = res.data;
        setPrompts(list);

        // Find or initialize defaults
        const projP = list.find(p => p.type === 'PROJECT') || { project_id: projectId, type: 'PROJECT', name: 'Project Check Prompt', prompt_content: '', active: true };
        const phaseP = list.find(p => p.type === 'PHASE') || { project_id: projectId, type: 'PHASE', name: 'Phase Check Prompt', prompt_content: '', active: true };
        const taskP = list.find(p => p.type === 'TASK') || { project_id: projectId, type: 'TASK', name: 'Task Check Prompt', prompt_content: '', active: true };

        setProjectPrompt(projP);
        setPhasePrompt(phaseP);
        setTaskPrompt(taskP);
      }
    } catch (err) {
      console.error(err);
      onFlash('Lỗi tải danh sách prompts');
    } finally {
      setLoadingPrompts(false);
    }
  };

  const handleSavePrompt = async (type: 'PROJECT' | 'PHASE' | 'TASK') => {
    if (!selectedProjectId) return;
    setSavingPromptId(type);
    
    let targetPrompt = projectPrompt;
    if (type === 'PHASE') targetPrompt = phasePrompt;
    if (type === 'TASK') targetPrompt = taskPrompt;

    try {
      const payload = {
        ...targetPrompt,
        project_id: selectedProjectId,
      };
      const res = await saveAIPrompt(payload);
      if (res.success) {
        onFlash(`Đã lưu cấu hình Prompt cấp ${type === 'PROJECT' ? 'Dự án' : type === 'PHASE' ? 'Giai đoạn' : 'Công việc'} thành công!`);
        loadPrompts(selectedProjectId);
      }
    } catch (err: any) {
      console.error(err);
      onFlash(err.response?.data?.detail || 'Lỗi khi lưu cấu hình prompt');
    } finally {
      setSavingPromptId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Project selector */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">Cấu hình AI Review Prompts</h1>
          <p className="text-xs text-slate-500 mt-1">
            Thiết lập Prompt riêng cho từng dự án ở cả 3 cấp độ: Dự án, Giai đoạn và Công việc.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Chọn dự án:</span>
          {loadingProjects ? (
            <div className="h-9 w-48 bg-slate-100 animate-pulse rounded-lg"></div>
          ) : (
            <select
              value={selectedProjectId || ''}
              onChange={e => setSelectedProjectId(Number(e.target.value))}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#0b1c30] outline-none focus:border-blue-500 transition-all cursor-pointer min-w-[200px] shadow-sm"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {loadingPrompts ? (
        <div className="grid grid-cols-1 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm animate-pulse">
              <div className="h-5 w-48 bg-slate-200 rounded"></div>
              <div className="h-4 w-72 bg-slate-100 rounded"></div>
              <div className="h-32 bg-slate-50 rounded"></div>
            </div>
          ))}
        </div>
      ) : selectedProjectId ? (
        <div className="grid grid-cols-1 gap-6">
          {/* PROJECT PROMPT */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                  📂 Cấp 1: Project Prompt
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">
                  Đánh giá sức khỏe tổng thể dự án, rủi ro, phân bổ nguồn lực, tiến độ
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={projectPrompt.active}
                    onChange={e => setProjectPrompt({ ...projectPrompt, active: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <span>Hoạt động</span>
                </label>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên prompt</label>
                <input
                  type="text"
                  value={projectPrompt.name}
                  onChange={e => setProjectPrompt({ ...projectPrompt, name: e.target.value })}
                  placeholder="Ví dụ: Đánh giá Dự án..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0b1c30] placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nội dung prompt</label>
                <textarea
                  rows={5}
                  value={projectPrompt.prompt_content}
                  onChange={e => setProjectPrompt({ ...projectPrompt, prompt_content: e.target.value })}
                  placeholder="Nhập prompt đánh giá dự án..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0b1c30] placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleSavePrompt('PROJECT')}
                  disabled={savingPromptId !== null}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingPromptId === 'PROJECT' ? 'Đang lưu...' : 'Lưu Project Prompt'}
                </button>
              </div>
            </div>
          </div>

          {/* PHASE PROMPT */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                  ⛓️ Cấp 2: Phase Prompt
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">
                  Đánh giá phase, task overdue, phân phối tài nguyên, thiếu task
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={phasePrompt.active}
                    onChange={e => setPhasePrompt({ ...phasePrompt, active: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <span>Hoạt động</span>
                </label>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên prompt</label>
                <input
                  type="text"
                  value={phasePrompt.name}
                  onChange={e => setPhasePrompt({ ...phasePrompt, name: e.target.value })}
                  placeholder="Ví dụ: Đánh giá Giai đoạn..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0b1c30] placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nội dung prompt</label>
                <textarea
                  rows={5}
                  value={phasePrompt.prompt_content}
                  onChange={e => setPhasePrompt({ ...phasePrompt, prompt_content: e.target.value })}
                  placeholder="Nhập prompt đánh giá giai đoạn..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0b1c30] placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleSavePrompt('PHASE')}
                  disabled={savingPromptId !== null}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingPromptId === 'PHASE' ? 'Đang lưu...' : 'Lưu Phase Prompt'}
                </button>
              </div>
            </div>
          </div>

          {/* TASK PROMPT */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
                  📝 Cấp 3: Task Prompt
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">
                  Đánh giá chi tiết task, manday, kết quả đầu ra, rủi ro, chỉ số KPI
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={taskPrompt.active}
                    onChange={e => setTaskPrompt({ ...taskPrompt, active: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <span>Hoạt động</span>
                </label>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tên prompt</label>
                <input
                  type="text"
                  value={taskPrompt.name}
                  onChange={e => setTaskPrompt({ ...taskPrompt, name: e.target.value })}
                  placeholder="Ví dụ: Đánh giá Công việc..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0b1c30] placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nội dung prompt</label>
                <textarea
                  rows={5}
                  value={taskPrompt.prompt_content}
                  onChange={e => setTaskPrompt({ ...taskPrompt, prompt_content: e.target.value })}
                  placeholder="Nhập prompt đánh giá công việc..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0b1c30] placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleSavePrompt('TASK')}
                  disabled={savingPromptId !== null}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingPromptId === 'TASK' ? 'Đang lưu...' : 'Lưu Task Prompt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic text-center py-10">Vui lòng chọn một dự án để cấu hình.</p>
      )}
    </div>
  );
}
