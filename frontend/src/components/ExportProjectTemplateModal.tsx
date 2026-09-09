'use client';
import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, FileOutput, Search, X } from 'lucide-react';
import { exportProjectToTemplate, getApiErrorMessage } from '@/lib/api';

interface TaskNode {
  id: number;
  detail: string;
}
interface GroupNode {
  id: number;
  name: string;
  tasks: TaskNode[];
}
interface PhaseNode {
  id: number;
  name: string;
  groups: GroupNode[];
}

type NodeState = 'checked' | 'unchecked' | 'indeterminate';

interface Props {
  projectId: number;
  projectName: string;
  phases: any[];
  taskGroups: any[];
  tasks: any[];
  onClose: () => void;
  onSuccess: (result: { template_id: number; name: string; created_phase_count: number; created_group_count: number; created_task_count: number }) => void;
}

export default function ExportProjectTemplateModal({ projectId, projectName, phases, taskGroups, tasks, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedPhaseIds, setSelectedPhaseIds] = useState<Set<number>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [templateName, setTemplateName] = useState(`${projectName} Template`);
  const [description, setDescription] = useState(`Template được tạo từ project ${projectName}`);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{ template_id: number; name: string; created_phase_count: number; created_group_count: number; created_task_count: number } | null>(null);

  // ── Build the Phase → Group → Task tree once from the 3 flat arrays
  // already loaded by the page (no new fetch). ──────────────────────────
  const tree: PhaseNode[] = useMemo(() => {
    const groupsByPhase = new Map<number, any[]>();
    for (const g of taskGroups || []) {
      const list = groupsByPhase.get(g.phase_id) || [];
      list.push(g);
      groupsByPhase.set(g.phase_id, list);
    }
    const tasksByGroup = new Map<number, any[]>();
    for (const t of tasks || []) {
      const list = tasksByGroup.get(t.task_group_id) || [];
      list.push(t);
      tasksByGroup.set(t.task_group_id, list);
    }
    return (phases || [])
      .slice()
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        groups: (groupsByPhase.get(p.id) || [])
          .slice()
          .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
          .map((g: any) => ({
            id: g.id,
            name: g.name,
            tasks: (tasksByGroup.get(g.id) || [])
              .slice()
              .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
              .map((t: any) => ({ id: t.id, detail: t.detail })),
          })),
      }));
  }, [phases, taskGroups, tasks]);

  const totalCounts = useMemo(() => {
    const groupCount = tree.reduce((acc, p) => acc + p.groups.length, 0);
    const taskCount = tree.reduce((acc, p) => acc + p.groups.reduce((a2, g) => a2 + g.tasks.length, 0), 0);
    return { phases: tree.length, groups: groupCount, tasks: taskCount };
  }, [tree]);

  const selectedCounts = useMemo(() => ({
    phases: selectedPhaseIds.size,
    groups: selectedGroupIds.size,
    tasks: selectedTaskIds.size,
  }), [selectedPhaseIds, selectedGroupIds, selectedTaskIds]);

  // ── 3-state checkbox helpers — pure functions over the 3 Sets, no
  // per-node state. ─────────────────────────────────────────────────────
  const getTaskState = (taskId: number): NodeState => (selectedTaskIds.has(taskId) ? 'checked' : 'unchecked');

  const getGroupState = (group: GroupNode): NodeState => {
    if (group.tasks.length === 0) return selectedGroupIds.has(group.id) ? 'checked' : 'unchecked';
    const checkedCount = group.tasks.filter(t => selectedTaskIds.has(t.id)).length;
    if (checkedCount === 0) return 'unchecked';
    if (checkedCount === group.tasks.length) return 'checked';
    return 'indeterminate';
  };

  const getPhaseState = (phase: PhaseNode): NodeState => {
    if (phase.groups.length === 0) return selectedPhaseIds.has(phase.id) ? 'checked' : 'unchecked';
    const states = phase.groups.map(getGroupState);
    if (states.every(s => s === 'checked')) return 'checked';
    if (states.every(s => s === 'unchecked')) return 'unchecked';
    return 'indeterminate';
  };

  // Recomputes selectedGroupIds/selectedPhaseIds from `nextTaskIds` — a group/phase
  // is included iff it has ≥1 selected descendant task, OR it's a childless
  // container (0 groups/0 tasks, e.g. Lab/PoC) that was explicitly checked via its
  // own checkbox (carried through explicitGroupIds/explicitPhaseIds). This keeps
  // the 3 Sets internally consistent — e.g. unchecking a group's last task also
  // drops that group (and its phase, if now empty) instead of leaving a stale id
  // behind that would otherwise still get sent to the backend as "selected".
  const applySelection = (nextTaskIds: Set<number>, explicitGroupIds: Set<number>, explicitPhaseIds: Set<number>) => {
    const nextGroupIds = new Set<number>();
    const nextPhaseIds = new Set<number>();
    for (const phase of tree) {
      let phaseHasSelection = false;
      for (const group of phase.groups) {
        const groupHasSelection = group.tasks.some(t => nextTaskIds.has(t.id));
        const groupLeafChecked = group.tasks.length === 0 && explicitGroupIds.has(group.id);
        if (groupHasSelection || groupLeafChecked) {
          nextGroupIds.add(group.id);
          phaseHasSelection = true;
        }
      }
      const phaseLeafChecked = phase.groups.length === 0 && explicitPhaseIds.has(phase.id);
      if (phaseHasSelection || phaseLeafChecked) {
        nextPhaseIds.add(phase.id);
      }
    }
    setSelectedTaskIds(nextTaskIds);
    setSelectedGroupIds(nextGroupIds);
    setSelectedPhaseIds(nextPhaseIds);
  };

  const toggleTask = (task: TaskNode, checked: boolean) => {
    const nextTaskIds = new Set(selectedTaskIds);
    if (checked) nextTaskIds.add(task.id); else nextTaskIds.delete(task.id);
    applySelection(nextTaskIds, selectedGroupIds, selectedPhaseIds);
  };

  const toggleGroup = (group: GroupNode, checked: boolean) => {
    const nextTaskIds = new Set(selectedTaskIds);
    for (const t of group.tasks) {
      if (checked) nextTaskIds.add(t.id); else nextTaskIds.delete(t.id);
    }
    const explicitGroupIds = new Set(selectedGroupIds);
    if (checked) explicitGroupIds.add(group.id); else explicitGroupIds.delete(group.id);
    applySelection(nextTaskIds, explicitGroupIds, selectedPhaseIds);
  };

  const togglePhase = (phase: PhaseNode, checked: boolean) => {
    const nextTaskIds = new Set(selectedTaskIds);
    const explicitGroupIds = new Set(selectedGroupIds);
    for (const g of phase.groups) {
      for (const t of g.tasks) {
        if (checked) nextTaskIds.add(t.id); else nextTaskIds.delete(t.id);
      }
      if (checked) explicitGroupIds.add(g.id); else explicitGroupIds.delete(g.id);
    }
    const explicitPhaseIds = new Set(selectedPhaseIds);
    if (checked) explicitPhaseIds.add(phase.id); else explicitPhaseIds.delete(phase.id);
    applySelection(nextTaskIds, explicitGroupIds, explicitPhaseIds);
  };

  const selectAll = () => {
    setSelectedPhaseIds(new Set(tree.map(p => p.id)));
    setSelectedGroupIds(new Set(tree.flatMap(p => p.groups.map(g => g.id))));
    setSelectedTaskIds(new Set(tree.flatMap(p => p.groups.flatMap(g => g.tasks.map(t => t.id)))));
  };

  const clearAll = () => {
    setSelectedPhaseIds(new Set());
    setSelectedGroupIds(new Set());
    setSelectedTaskIds(new Set());
  };

  // ── Search only affects which nodes are VISIBLE, never the selection. ──
  const matchesSearch = (label: string) => !searchTerm.trim() || label.toLowerCase().includes(searchTerm.trim().toLowerCase());
  const phaseVisible = (phase: PhaseNode) =>
    matchesSearch(phase.name) || phase.groups.some(g => matchesSearch(g.name) || g.tasks.some(t => matchesSearch(t.detail)));
  const groupVisible = (group: GroupNode) =>
    matchesSearch(group.name) || group.tasks.some(t => matchesSearch(t.detail));

  const [expandedPhaseIds, setExpandedPhaseIds] = useState<Set<number>>(new Set(tree.map(p => p.id)));
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set());
  const isPhaseExpanded = (id: number) => searchTerm.trim() !== '' || expandedPhaseIds.has(id);
  const isGroupExpanded = (id: number) => searchTerm.trim() !== '' || expandedGroupIds.has(id);
  const togglePhaseExpanded = (id: number) => setExpandedPhaseIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleGroupExpanded = (id: number) => setExpandedGroupIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── Preview tree for Step 3 — only the selected subset. ─────────────────
  const previewTree = useMemo(() => {
    return tree
      .filter(p => selectedPhaseIds.has(p.id))
      .map(p => ({
        ...p,
        groups: p.groups
          .filter(g => selectedGroupIds.has(g.id))
          .map(g => ({ ...g, tasks: g.tasks.filter(t => selectedTaskIds.has(t.id)) })),
      }));
  }, [tree, selectedPhaseIds, selectedGroupIds, selectedTaskIds]);

  const canGoToStep2 = selectedCounts.phases > 0;
  const canGoToStep3 = templateName.trim() !== '';

  const handleExport = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await exportProjectToTemplate(projectId, {
        name: templateName.trim(),
        description: description.trim(),
        selected_phase_ids: Array.from(selectedPhaseIds),
        selected_task_group_ids: Array.from(selectedGroupIds),
        selected_task_ids: Array.from(selectedTaskIds),
      });
      setSuccessResult(result);
    } catch (err: any) {
      setSubmitError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseAfterSuccess = () => {
    if (successResult) onSuccess(successResult);
    onClose();
  };

  const CheckboxTri = ({ state, onChange }: { state: NodeState; onChange: (checked: boolean) => void }) => (
    <input
      type="checkbox"
      checked={state === 'checked'}
      ref={el => { if (el) el.indeterminate = state === 'indeterminate'; }}
      onChange={e => onChange(e.target.checked)}
      className="w-4 h-4 rounded border-slate-300 text-[#0058be] focus:ring-[#0058be] cursor-pointer shrink-0"
      onClick={e => e.stopPropagation()}
    />
  );

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[85vh]">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-[#0058be]">
            <FileOutput size={26} />
            <div>
              <h3 className="text-base font-bold text-[#0b1c30]">Xuất thành Template</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {successResult ? 'Hoàn tất' : `Bước ${step}/3 — Project: ${projectName}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {successResult ? (
          <div className="p-8 text-center space-y-3">
            <div className="text-emerald-600 text-4xl">✓</div>
            <div className="text-sm font-bold text-[#0b1c30]">Xuất Template thành công</div>
            <div className="text-sm font-semibold text-[#0058be]">{successResult.name}</div>
            <div className="text-xs text-slate-500">
              {successResult.created_phase_count} Phase · {successResult.created_group_count} Task Group · {successResult.created_task_count} Task
            </div>
            <div className="text-xs text-slate-400">Template đã được thêm vào Settings → Project Template</div>
          </div>
        ) : (
          <>
            {step === 1 && (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="px-6 pt-4 space-y-2 shrink-0">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Tìm Phase, Task Group hoặc Task..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#0058be]"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button onClick={selectAll} className="text-[11px] font-semibold text-[#0058be] hover:underline">Chọn tất cả</button>
                      <span className="text-slate-300">|</span>
                      <button onClick={clearAll} className="text-[11px] font-semibold text-slate-500 hover:underline">Bỏ chọn tất cả</button>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium">
                      Đã chọn: {selectedCounts.phases}/{totalCounts.phases} Phase · {selectedCounts.groups}/{totalCounts.groups} Task Group · {selectedCounts.tasks}/{totalCounts.tasks} Task
                    </div>
                  </div>
                </div>

                <div className="p-4 overflow-y-auto flex-1 space-y-1">
                  {tree.filter(phaseVisible).length === 0 ? (
                    <div className="text-xs text-slate-400 italic text-center py-8">Không có Phase nào khớp tìm kiếm.</div>
                  ) : (
                    tree.filter(phaseVisible).map(phase => {
                      const pState = getPhaseState(phase);
                      const expanded = isPhaseExpanded(phase.id);
                      return (
                        <div key={phase.id} className="border border-slate-100 rounded-lg">
                          <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-slate-50" onClick={() => togglePhaseExpanded(phase.id)}>
                            {phase.groups.length > 0 ? (expanded ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />) : <span className="w-3.5 shrink-0" />}
                            <CheckboxTri state={pState} onChange={checked => togglePhase(phase, checked)} />
                            <span className="text-xs font-bold text-[#0b1c30] flex-1 truncate">{phase.name}</span>
                          </div>
                          {expanded && phase.groups.filter(groupVisible).length > 0 && (
                            <div className="pl-6 pb-1 space-y-0.5">
                              {phase.groups.filter(groupVisible).map(group => {
                                const gState = getGroupState(group);
                                const gExpanded = isGroupExpanded(group.id);
                                return (
                                  <div key={group.id}>
                                    <div className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-slate-50 rounded" onClick={() => toggleGroupExpanded(group.id)}>
                                      {group.tasks.length > 0 ? (gExpanded ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />) : <span className="w-3.5 shrink-0" />}
                                      <CheckboxTri state={gState} onChange={checked => toggleGroup(group, checked)} />
                                      <span className="text-[11px] font-semibold text-slate-700 flex-1 truncate">{group.name}</span>
                                    </div>
                                    {gExpanded && group.tasks.filter(t => matchesSearch(t.detail)).length > 0 && (
                                      <div className="pl-6 space-y-0.5">
                                        {group.tasks.filter(t => matchesSearch(t.detail)).map(task => (
                                          <div key={task.id} className="flex items-center gap-1.5 px-2 py-1">
                                            <CheckboxTri state={getTaskState(task.id)} onChange={checked => toggleTask(task, checked)} />
                                            <span className="text-[11px] text-slate-600 truncate">{task.detail}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tên Template *</label>
                  <input
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Mô tả</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                  />
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] font-bold text-slate-500 uppercase mb-2">Cấu trúc đã chọn</div>
                  <div className="text-xs text-slate-700">
                    {selectedCounts.phases} Phases · {selectedCounts.groups} Task Groups · {selectedCounts.tasks} Tasks
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="p-6 overflow-y-auto flex-1 space-y-3">
                <div className="text-sm font-bold text-[#0b1c30]">{templateName.trim()}</div>
                <div className="text-xs text-slate-500">
                  {selectedCounts.phases} Phases · {selectedCounts.groups} Task Groups · {selectedCounts.tasks} Tasks
                </div>
                <div className="border-t border-slate-100 pt-3 space-y-2">
                  {previewTree.map(phase => (
                    <div key={phase.id}>
                      <div className="text-xs font-bold text-[#0b1c30]">{phase.name}</div>
                      {phase.groups.map(group => (
                        <div key={group.id} className="pl-4">
                          <div className="text-[11px] font-semibold text-slate-600">└ {group.name}</div>
                          {group.tasks.map(task => (
                            <div key={task.id} className="pl-4 text-[11px] text-slate-500">├ {task.detail}</div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
                  Template này sẽ được lưu vào Settings → Project Template.
                </div>
                {submitError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-700 font-medium">
                    ❌ {submitError}
                  </div>
                )}
              </div>
            )}

            <div className="bg-slate-50 px-6 py-4 flex justify-between border-t border-slate-100 shrink-0">
              <button
                onClick={() => (step === 1 ? onClose() : setStep((step - 1) as 1 | 2))}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                {step === 1 ? 'Hủy' : '← Quay lại'}
              </button>
              {step < 3 ? (
                <button
                  onClick={() => setStep((step + 1) as 2 | 3)}
                  disabled={step === 1 ? !canGoToStep2 : !canGoToStep3}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors disabled:opacity-50"
                >
                  Tiếp tục →
                </button>
              ) : (
                <button
                  onClick={handleExport}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Đang xuất...' : 'Xuất thành Template'}
                </button>
              )}
            </div>
          </>
        )}

        {successResult && (
          <div className="bg-slate-50 px-6 py-4 flex justify-end border-t border-slate-100 shrink-0">
            <button
              onClick={handleCloseAfterSuccess}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors"
            >
              Đóng
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
