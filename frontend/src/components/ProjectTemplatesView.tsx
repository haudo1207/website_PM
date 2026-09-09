'use client';
import React, { useEffect, useState } from 'react';
import {
  getProjectTemplates,
  createProjectTemplate,
  updateProjectTemplate,
  deleteProjectTemplate,
  getCategories,
  getPriorities,
  getApiErrorMessage
} from '@/lib/api';

const FALLBACK_PRIORITIES = ['Normal', 'High', 'Critical', 'Interrupt'];

interface TemplateTask {
  id?: number;
  _uid?: string;
  detail: string;
  priority?: string;
  manday_est?: number;
  status?: string;
  skill_solution_id?: number | null;
  skill_vendor_id?: number | null;
  sort_order?: number;
}

interface TemplateTaskGroup {
  id?: number;
  _uid?: string;
  name: string;
  description?: string;
  manday_est?: number | null;
  sort_order?: number;
  tasks?: TemplateTask[];
}

interface TemplatePhase {
  id?: number;
  name: string;
  description?: string;
  sort_order?: number;
  is_active?: boolean;
  task_groups?: TemplateTaskGroup[];
}

interface Template {
  id: number;
  name: string;
  description?: string;
  is_active?: boolean;
  phases?: TemplatePhase[];
}

interface Props {
  onFlash: (msg: string) => void;
}

export default function ProjectTemplatesView({ onFlash }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);

  // Create/Edit Template Modal
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [phases, setPhases] = useState<TemplatePhase[]>([]);

  // Expanded state for viewing template details
  const [expandedTemplateId, setExpandedTemplateId] = useState<number | null>(null);

  // Skill Solution/Vendor + Priority options, shared by every Task Con row
  const [categories, setCategories] = useState<any[]>([]);
  const [priorities, setPriorities] = useState<any[]>([]);
  const skillGroups = categories.filter(c => c.is_active).flatMap(c => c.groups || []);
  const priorityOptions = priorities.length > 0 ? priorities.map((p: any) => p.name) : FALLBACK_PRIORITIES;

  useEffect(() => {
    getCategories().then(data => setCategories(data || [])).catch(() => setCategories([]));
    getPriorities().then(data => setPriorities(data || [])).catch(() => setPriorities([]));
  }, []);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await getProjectTemplates();
      setTemplates(data || []);
    } catch (err: any) {
      onFlash('Không thể tải danh sách template: ' + getApiErrorMessage(err, 'Lỗi'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreateModal = () => {
    setEditingTemplate(null);
    setTemplateName('');
    setTemplateDesc('');
    setPhases([
      { name: '1. Sale/Admin', description: 'Khởi tạo phạm vi, kickoff và điều phối ban đầu', sort_order: 1, is_active: true, task_groups: [] },
      { name: '2. Init', description: 'Khảo sát, phân tích và làm kế hoạch triển khai', sort_order: 2, is_active: true, task_groups: [] },
      { name: '2.1 Lab/PoC', description: 'Chứng minh tính khả thi và thử nghiệm trước triển khai', sort_order: 3, is_active: true, task_groups: [] },
      { name: '3. Implement', description: 'Triển khai chính và kiểm thử tích hợp', sort_order: 4, is_active: true, task_groups: [] },
      { name: '4. MA', description: 'Hỗ trợ vận hành và bảo trì sau go-live', sort_order: 5, is_active: true, task_groups: [] },
    ]);
    setShowModal(true);
  };

  const openEditModal = (template: Template) => {
    setEditingTemplate(template);
    setTemplateName(template.name || '');
    setTemplateDesc(template.description || '');
    setPhases((template.phases || []).map((p, idx) => ({
      ...p,
      sort_order: p.sort_order ?? idx + 1,
      task_groups: p.task_groups || []
    })));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      onFlash('Tên template không được để trống!');
      return;
    }
    // Validate phases
    const validPhases = phases.filter(p => p.name.trim());
    if (validPhases.length === 0) {
      onFlash('Template phải có ít nhất 1 Phase!');
      return;
    }
    // Duplicate phase names would silently fail later when someone tries to Apply this
    // template — catch it here, at save time, instead.
    const seenPhaseNames = new Set<string>();
    for (const p of validPhases) {
      const trimmed = p.name.trim();
      if (seenPhaseNames.has(trimmed)) {
        onFlash(`Tên Phase bị trùng: "${trimmed}". Mỗi Phase phải có tên khác nhau.`);
        return;
      }
      seenPhaseNames.add(trimmed);
    }
    // Every task must have both Skill Solution and Skill Vendor set — otherwise, applying
    // the template later silently drops the task or falls back to an arbitrary skill/group.
    for (const p of validPhases) {
      const groups = (p.task_groups || []).filter(g => g.name.trim());
      for (const g of groups) {
        const tasks = (g.tasks || []).filter(t => t.detail.trim());
        for (const t of tasks) {
          if (!t.skill_solution_id || !t.skill_vendor_id) {
            onFlash(`Task "${t.detail.trim()}" (task cha "${g.name.trim()}", Phase "${p.name.trim()}") chưa chọn đủ Skill Solution và Skill Vendor.`);
            return;
          }
        }
      }
    }

    const payload = {
      name: templateName.trim(),
      description: templateDesc.trim(),
      phases: validPhases.map((p, pIdx) => ({
        name: p.name.trim(),
        description: p.description || '',
        sort_order: pIdx + 1,
        is_active: p.is_active !== false,
        task_groups: (p.task_groups || [])
          .filter(g => g.name.trim())
          .map((g, gIdx) => ({
            name: g.name.trim(),
            description: g.description || '',
            manday_est: g.manday_est || null,
            sort_order: gIdx + 1,
            tasks: (g.tasks || []).filter(t => t.detail.trim()).map((t, tIdx) => ({
              detail: t.detail.trim(),
              priority: t.priority || 'Normal',
              manday_est: t.manday_est || 1,
              status: t.status || 'Waiting',
              skill_solution_id: t.skill_solution_id || null,
              skill_vendor_id: t.skill_vendor_id || null,
              sort_order: tIdx + 1
            }))
          }))
      }))
    };

    try {
      if (editingTemplate) {
        await updateProjectTemplate(editingTemplate.id, payload);
        onFlash('Cập nhật template thành công!');
      } else {
        await createProjectTemplate(payload);
        onFlash('Tạo template thành công!');
      }
      setShowModal(false);
      reload();
    } catch (err: any) {
      onFlash('Lỗi: ' + getApiErrorMessage(err));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa template này?')) return;
    try {
      await deleteProjectTemplate(id);
      onFlash('Đã xóa template!');
      reload();
    } catch (err: any) {
      onFlash('Lỗi xóa template: ' + getApiErrorMessage(err));
    }
  };

  // Phase operations
  const addPhase = () => {
    setPhases(prev => [...prev, { name: '', description: '', sort_order: prev.length + 1, is_active: true, task_groups: [] }]);
  };

  const updatePhase = (idx: number, field: string, value: any) => {
    setPhases(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const removePhase = (idx: number) => {
    setPhases(prev => prev.filter((_, i) => i !== idx));
  };

  // Task Group operations
  const addTaskGroup = (phaseIdx: number) => {
    setPhases(prev => prev.map((p, i) => {
      if (i !== phaseIdx) return p;
      const groups = p.task_groups || [];
      return { ...p, task_groups: [...groups, { _uid: crypto.randomUUID(), name: '', description: '', manday_est: null, sort_order: groups.length + 1, tasks: [] }] };
    }));
  };

  const updateTaskGroup = (phaseIdx: number, groupIdx: number, field: string, value: any) => {
    setPhases(prev => prev.map((p, i) => {
      if (i !== phaseIdx) return p;
      const groups = (p.task_groups || []).map((g, gi) => gi === groupIdx ? { ...g, [field]: value } : g);
      return { ...p, task_groups: groups };
    }));
  };

  const removeTaskGroup = (phaseIdx: number, groupIdx: number) => {
    setPhases(prev => prev.map((p, i) => {
      if (i !== phaseIdx) return p;
      return { ...p, task_groups: (p.task_groups || []).filter((_, gi) => gi !== groupIdx) };
    }));
  };

  // Task operations (child tasks)
  const addTask = (phaseIdx: number, groupIdx: number) => {
    setPhases(prev => prev.map((p, i) => {
      if (i !== phaseIdx) return p;
      const groups = (p.task_groups || []).map((g, gi) => {
        if (gi !== groupIdx) return g;
        const tasks = g.tasks || [];
        return { ...g, tasks: [...tasks, { _uid: crypto.randomUUID(), detail: '', priority: 'Normal', manday_est: 1, status: 'Waiting', skill_solution_id: null, skill_vendor_id: null, sort_order: tasks.length + 1 }] };
      });
      return { ...p, task_groups: groups };
    }));
  };

  const updateTask = (phaseIdx: number, groupIdx: number, taskIdx: number, field: string, value: any) => {
    setPhases(prev => prev.map((p, i) => {
      if (i !== phaseIdx) return p;
      const groups = (p.task_groups || []).map((g, gi) => {
        if (gi !== groupIdx) return g;
        const tasks = (g.tasks || []).map((t, ti) => {
          if (ti !== taskIdx) return t;
          if (field === 'skill_solution_id') return { ...t, skill_solution_id: value, skill_vendor_id: null };
          return { ...t, [field]: value };
        });
        return { ...g, tasks };
      });
      return { ...p, task_groups: groups };
    }));
  };

  const removeTask = (phaseIdx: number, groupIdx: number, taskIdx: number) => {
    setPhases(prev => prev.map((p, i) => {
      if (i !== phaseIdx) return p;
      const groups = (p.task_groups || []).map((g, gi) => {
        if (gi !== groupIdx) return g;
        return { ...g, tasks: (g.tasks || []).filter((_, ti) => ti !== taskIdx) };
      });
      return { ...p, task_groups: groups };
    }));
  };

  const toggleExpand = (id: number) => {
    setExpandedTemplateId(prev => prev === id ? null : id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Quản lý Template Dự án</h1>
          <p className="text-sm text-slate-500 mt-1">Tạo và quản lý các template chuẩn để áp dụng nhanh cho dự án mới.</p>
        </div>
        <button
          onClick={openCreateModal}
          className="bg-[#0058be] hover:bg-[#0058be]/90 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 shadow-sm transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Tạo template mới
        </button>
      </div>

      {/* Template List */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-500">Đang tải template...</div>
        ) : templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
            <span className="material-symbols-outlined text-slate-300 text-[48px] block mb-2">schema</span>
            <p className="text-sm font-semibold text-slate-500">Chưa có template nào</p>
            <p className="text-xs text-slate-400 mt-1">Nhấn "Tạo template mới" để tạo template đầu tiên</p>
          </div>
        ) : (
          templates.map(template => (
            <div key={template.id} className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Template Header */}
              <div className="flex items-center justify-between p-4 bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => toggleExpand(template.id)}>
                <div className="flex items-center gap-3">
                  <span className={`material-symbols-outlined transition-transform ${expandedTemplateId === template.id ? 'rotate-90' : ''} text-slate-400`}>
                    chevron_right
                  </span>
                  <div>
                    <div className="font-semibold text-sm text-[#0b1c30]">{template.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{template.description || 'Không có mô tả'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-bold">
                    {template.phases?.length || 0} phases
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditModal(template); }}
                    className="text-[12px] text-blue-600 hover:underline font-medium"
                  >
                    Sửa
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(template.id); }}
                    className="text-[12px] text-red-600 hover:underline font-medium"
                  >
                    Xóa
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedTemplateId === template.id && (
                <div className="border-t border-slate-100 p-4 space-y-3 bg-white">
                  {(template.phases || []).length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-4">Template này chưa có Phase nào.</p>
                  ) : (
                    (template.phases || []).map((phase, pIdx) => (
                      <div key={phase.id || pIdx} className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-2.5 bg-[#f0f4ff] border-b border-slate-200 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-[#0058be] bg-white border border-[#0058be]/20 px-2 py-0.5 rounded-full">
                              Phase {pIdx + 1}
                            </span>
                            <span className="text-sm font-bold text-[#0b1c30]">{phase.name}</span>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {(phase.task_groups || []).length} task cha
                          </span>
                        </div>
                        <div className="p-3 space-y-2">
                          {(phase.task_groups || []).length === 0 ? (
                            <p className="text-[11px] text-slate-400 italic text-center py-2">
                              {phase.name.toLowerCase().includes('lab') || phase.name.toLowerCase().includes('poc')
                                ? 'Phase Lab/PoC không cần task cha — người dùng tự thêm khi cần.'
                                : 'Chưa có task cha nào.'}
                            </p>
                          ) : (
                            (phase.task_groups || []).map((group, gIdx) => (
                              <div key={group.id || gIdx} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                                <span className="text-[10px] font-bold text-slate-400 w-6 text-center">{gIdx + 1}.</span>
                                <span className="text-xs font-semibold text-[#0b1c30] flex-1">{group.name}</span>
                                {(group.tasks || []).length > 0 && (
                                  <span className="text-[10px] text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full">
                                    {group.tasks!.length} task con
                                  </span>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create/Edit Template Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[#0058be] text-[24px]">schema</span>
                <div>
                  <h3 className="text-base font-bold text-[#0b1c30]">
                    {editingTemplate ? 'Chỉnh sửa Template' : 'Tạo Template mới'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Định nghĩa các Phase và Task cha cho template</p>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {/* Template Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tên template *</label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    placeholder="VD: Template dự án chuẩn, Template MA..."
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Mô tả</label>
                  <input
                    type="text"
                    value={templateDesc}
                    onChange={e => setTemplateDesc(e.target.value)}
                    placeholder="Mô tả ngắn về template..."
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                  />
                </div>
              </div>

              {/* Phases */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[#0b1c30] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#0058be] text-[18px]">layers</span>
                    Các Phase
                  </h4>
                  <button
                    onClick={addPhase}
                    className="text-[12px] font-bold text-[#0058be] hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">add</span>
                    Thêm Phase
                  </button>
                </div>

                {phases.length === 0 ? (
                  <p className="text-xs text-slate-400 italic text-center py-4 border border-dashed border-slate-200 rounded-lg">
                    Chưa có Phase nào. Nhấn "Thêm Phase" để bắt đầu.
                  </p>
                ) : (
                  phases.map((phase, pIdx) => (
                    <div key={pIdx} className="border border-slate-200 rounded-lg overflow-hidden">
                      {/* Phase Header */}
                      <div className="px-4 py-2.5 bg-[#f0f4ff] border-b border-slate-200 flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#0058be] bg-white border border-[#0058be]/20 px-2 py-0.5 rounded-full shrink-0">
                          Phase {pIdx + 1}
                        </span>
                        <input
                          type="text"
                          value={phase.name}
                          onChange={e => updatePhase(pIdx, 'name', e.target.value)}
                          placeholder="Tên Phase (VD: 1. Sale/Admin)"
                          className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs font-bold text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                        />
                        <button
                          onClick={() => removePhase(pIdx)}
                          className="text-red-500 hover:text-red-700 p-1 shrink-0"
                          title="Xóa Phase"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>

                      {/* Phase Description */}
                      <div className="px-4 py-2 border-b border-slate-100">
                        <input
                          type="text"
                          value={phase.description || ''}
                          onChange={e => updatePhase(pIdx, 'description', e.target.value)}
                          placeholder="Mô tả Phase (tùy chọn)"
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-600 focus:outline-none focus:border-[#0058be]"
                        />
                      </div>

                      {/* Task Groups */}
                      <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-500 uppercase">Task cha</span>
                          <button
                            onClick={() => addTaskGroup(pIdx)}
                            className="text-[11px] font-bold text-[#0058be] hover:underline flex items-center gap-0.5"
                          >
                            <span className="material-symbols-outlined text-[13px]">add</span>
                            Thêm task cha
                          </button>
                        </div>

                        {(phase.task_groups || []).length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic text-center py-2 border border-dashed border-slate-200 rounded">
                            {phase.name.toLowerCase().includes('lab') || phase.name.toLowerCase().includes('poc')
                              ? 'Phase Lab/PoC không cần task cha — để trống.'
                              : 'Chưa có task cha nào.'}
                          </p>
                        ) : (
                          (phase.task_groups || []).map((group, gIdx) => (
                            <div key={group.id ?? group._uid ?? gIdx} className="border border-slate-100 rounded-lg p-2 space-y-2 bg-slate-50/50">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-slate-400 w-5 text-center shrink-0">{gIdx + 1}.</span>
                                <input
                                  type="text"
                                  value={group.name}
                                  onChange={e => updateTaskGroup(pIdx, gIdx, 'name', e.target.value)}
                                  placeholder="Tên task cha (VD: Sales trao đổi với khách hàng)"
                                  className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                />
                                <input
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  value={group.manday_est ?? ''}
                                  onChange={e => updateTaskGroup(pIdx, gIdx, 'manday_est', e.target.value ? Number(e.target.value) : null)}
                                  placeholder="Manday"
                                  title="Manday EST cho task cha"
                                  className="w-16 bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] shrink-0"
                                />
                                <button
                                  onClick={() => addTask(pIdx, gIdx)}
                                  className="text-[10px] font-bold text-emerald-600 hover:underline shrink-0"
                                  title="Thêm task con"
                                >
                                  + Task con
                                </button>
                                <button
                                  onClick={() => removeTaskGroup(pIdx, gIdx)}
                                  className="text-red-500 hover:text-red-700 p-0.5 shrink-0"
                                  title="Xóa task cha"
                                >
                                  <span className="material-symbols-outlined text-[14px]">close</span>
                                </button>
                              </div>

                              {/* Child Tasks */}
                              {(group.tasks || []).length > 0 && (
                                <div className="pl-7 space-y-2">
                                  {(group.tasks || []).map((task, tIdx) => {
                                    const availableSkills = skillGroups.find((g: any) => g.id === task.skill_solution_id)?.skills?.filter((s: any) => s.is_active) || [];
                                    return (
                                      <div key={task.id ?? task._uid ?? tIdx} className="border border-slate-100 rounded p-1.5 bg-white space-y-1">
                                        <div className="flex items-center gap-2">
                                          <span
                                            className="w-10 shrink-0 bg-[#f1f5f9] border border-slate-200 rounded px-1 py-0.5 text-[10px] font-mono font-bold text-slate-500 text-center"
                                            title="Task ID (tự động đánh số)"
                                          >
                                            {gIdx + 1}.{tIdx + 1}
                                          </span>
                                          <input
                                            type="text"
                                            value={task.detail}
                                            onChange={e => updateTask(pIdx, gIdx, tIdx, 'detail', e.target.value)}
                                            placeholder="Tên task con"
                                            className="flex-1 bg-white border border-slate-200 rounded px-2 py-0.5 text-[11px] text-slate-600 focus:outline-none focus:border-emerald-500"
                                          />
                                          <button
                                            onClick={() => removeTask(pIdx, gIdx, tIdx)}
                                            className="text-red-400 hover:text-red-600 p-0.5 shrink-0"
                                            title="Xóa task con"
                                          >
                                            <span className="material-symbols-outlined text-[12px]">close</span>
                                          </button>
                                        </div>
                                        <div className="grid grid-cols-4 gap-1.5 pl-12">
                                          <select
                                            value={task.priority || 'Normal'}
                                            onChange={e => updateTask(pIdx, gIdx, tIdx, 'priority', e.target.value)}
                                            title="Priority"
                                            className="bg-white border border-slate-200 rounded px-1 py-0.5 text-[10px] text-slate-600 focus:outline-none focus:border-emerald-500"
                                          >
                                            {priorityOptions.map((p: string) => <option key={p} value={p}>{p}</option>)}
                                          </select>
                                          <input
                                            type="number"
                                            min={0}
                                            step={0.5}
                                            value={task.manday_est ?? ''}
                                            onChange={e => updateTask(pIdx, gIdx, tIdx, 'manday_est', e.target.value ? Number(e.target.value) : null)}
                                            placeholder="Manday"
                                            title="Manday EST"
                                            className="bg-white border border-slate-200 rounded px-1 py-0.5 text-[10px] text-slate-600 focus:outline-none focus:border-emerald-500"
                                          />
                                          <select
                                            value={task.skill_solution_id ?? ''}
                                            onChange={e => updateTask(pIdx, gIdx, tIdx, 'skill_solution_id', e.target.value ? Number(e.target.value) : null)}
                                            title="Skill Solution (bắt buộc)"
                                            className={`bg-white border rounded px-1 py-0.5 text-[10px] text-slate-600 focus:outline-none focus:border-emerald-500 ${task.skill_solution_id ? 'border-slate-200' : 'border-red-300'}`}
                                          >
                                            <option value="">Skill Solution *</option>
                                            {skillGroups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                          </select>
                                          <select
                                            value={task.skill_vendor_id ?? ''}
                                            onChange={e => updateTask(pIdx, gIdx, tIdx, 'skill_vendor_id', e.target.value ? Number(e.target.value) : null)}
                                            title="Skill Vendor (bắt buộc)"
                                            disabled={!task.skill_solution_id}
                                            className={`bg-white border rounded px-1 py-0.5 text-[10px] text-slate-600 focus:outline-none focus:border-emerald-500 disabled:bg-slate-50 disabled:text-slate-300 ${task.skill_vendor_id || !task.skill_solution_id ? 'border-slate-200' : 'border-red-300'}`}
                                          >
                                            <option value="">Skill Vendor *</option>
                                            {availableSkills.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm"
              >
                {editingTemplate ? 'Cập nhật template' : 'Tạo template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}