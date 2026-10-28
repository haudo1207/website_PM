import React, { useEffect, useState } from 'react';
import {
  AICriteriaScope,
  AICriterion,
  applyAICriteriaSuggestions,
  getAICriteriaLatest,
  getAICriteriaPrompts,
  runAICriteriaCheck,
  saveAISkillCriteriaPrompt,
} from '@/lib/api';

interface CriteriaItem {
  task_id: number;
  task_code?: string | null;
  detail: string;
  assigned?: string | null;
  skill_area?: string | null;
  skill?: string | null;
  manday_est?: number | null;
  manday_actual?: number | null;
  status?: string;
  verdict: 'OK' | 'WARNING' | 'WRONG';
  reason: string;
  suggested_skill_area?: string | null;
  suggested_skill?: string | null;
  suggested_manday?: number | null;
  // Set by the backend on load: the task's criterion fields were edited (or
  // the task deleted) after this scan, so the verdict may be stale.
  changed?: boolean;
  deleted?: boolean;
  current_skill_area?: string | null;
  current_skill?: string | null;
  current_manday_est?: number | null;
  // One-click fix: suggestion is catalog-valid and the task is untouched
  // since the scan / the suggestion is already what the task holds.
  applicable?: boolean;
  applied?: boolean;
}

interface CriteriaLog {
  id: number;
  status: string;
  score: number;
  changed_count?: number;
  applicable_count?: number;
  items: CriteriaItem[];
  suggestions: string[];
  result_markdown: string;
  checked_at: string;
  prompt_snapshot?: string;
}

export interface CriteriaPrompts {
  skill: string;
  skillDefault: string;
  manday: string;
}

const VERDICT_STYLE: Record<CriteriaItem['verdict'], { label: string; cls: string }> = {
  OK: { label: 'Đạt', cls: 'bg-emerald-100 text-emerald-800' },
  WARNING: { label: 'Cần xem lại', cls: 'bg-amber-100 text-amber-800' },
  WRONG: { label: 'Chưa đúng', cls: 'bg-rose-100 text-rose-800' },
};

export function scopeLabel(scope: AICriteriaScope, memberName?: string) {
  const who = scope.entityType === 'MEMBER'
    ? `task của ${memberName || 'thành viên'}`
    : scope.entityType === 'PROJECT' ? 'toàn bộ task dự án'
    : scope.entityType === 'PHASE' ? 'task trong giai đoạn' : 'task này';
  const when = scope.month && scope.year ? `tháng ${scope.month}/${scope.year}`
    : scope.year ? `năm ${scope.year}`
    : scope.month ? `tháng ${scope.month} (mọi năm)` : 'mọi thời gian';
  return `${who} — ${when}`;
}

// Loads both criteria prompts for a project. Skill is editable (the edited
// text is sent with each Skill scan and can be saved for the project);
// Manday is hard-coded backend-side and only displayed here.
export function useCriteriaPrompts(projectId: number | undefined) {
  const [prompts, setPrompts] = useState<CriteriaPrompts>({ skill: '', skillDefault: '', manday: '' });
  const [savedSkill, setSavedSkill] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    getAICriteriaPrompts(projectId)
      .then(res => {
        if (!res.success || !res.data) return;
        setPrompts({
          skill: res.data.skill.prompt_content,
          skillDefault: res.data.skill.default_content,
          manday: res.data.manday.prompt_content,
        });
        setSavedSkill(res.data.skill.prompt_content);
      })
      .catch(err => console.error('Error loading criteria prompts:', err));
  }, [projectId]);

  const setSkill = (skill: string) => setPrompts(p => ({ ...p, skill }));

  const saveSkill = async () => {
    if (!projectId || !prompts.skill.trim()) return;
    setSaving(true);
    try {
      const res = await saveAISkillCriteriaPrompt(projectId, prompts.skill);
      if (res.success) setSavedSkill(res.data.prompt_content);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Không thể lưu prompt Skill.');
    } finally {
      setSaving(false);
    }
  };

  return { prompts, setSkill, saveSkill, saving, skillDirty: prompts.skill !== savedSkill };
}

export function CriteriaPromptConfig({
  prompts, setSkill, saveSkill, saving, skillDirty,
}: ReturnType<typeof useCriteriaPrompts>) {
  return (
    <details className="group bg-white border border-slate-200 rounded-xl shadow-sm">
      <summary className="px-5 py-3.5 text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer list-none flex items-center justify-between select-none">
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-indigo-500">tune</span>
          Cấu hình prompt đánh giá (Skill & Manday)
        </span>
        <span className="transition-transform group-open:rotate-180">▼</span>
      </summary>
      <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">🎯 Prompt đánh giá Skill Area & Skill</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSkill(prompts.skillDefault)}
                disabled={!prompts.skillDefault || prompts.skill === prompts.skillDefault}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-40"
              >
                Khôi phục mặc định
              </button>
              <button
                onClick={saveSkill}
                disabled={saving || !skillDirty || !prompts.skill.trim()}
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40"
              >
                {saving ? 'Đang lưu...' : 'Lưu prompt'}
              </button>
            </div>
          </div>
          <textarea
            value={prompts.skill}
            onChange={e => setSkill(e.target.value)}
            rows={7}
            className="w-full text-xs text-slate-700 border border-slate-200 rounded-lg p-3 leading-relaxed focus:outline-none focus:border-indigo-400"
          />
          <p className="text-[10px] text-slate-400">
            Nội dung đang hiển thị sẽ được gửi khi quét tab "Theo Skill"{skillDirty ? ' (chưa lưu — chỉ áp dụng cho lần quét này)' : ''}.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            ⏱ Prompt đánh giá Manday
            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-100 text-slate-500">CHỈ XEM</span>
          </label>
          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
            {prompts.manday || '...'}
          </div>
          <p className="text-[10px] text-slate-400">Prompt Manday được cấu hình cố định ở backend.</p>
        </div>
      </div>
    </details>
  );
}

export function CriteriaReport({
  criterion,
  scope,
  scopeText,
  skillPrompt,
  onOpenTask,
  onTasksChanged,
}: {
  criterion: AICriterion;
  scope: AICriteriaScope;
  scopeText: string;
  skillPrompt: string;
  // Jump to the task in the table so it can be fixed right away.
  onOpenTask?: (taskId: number) => void;
  // Suggestions were written onto tasks — let the page reload its table.
  onTasksChanged?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<number | 'all' | null>(null);

  const handleApply = async (taskIds?: number[]) => {
    if (!log) return;
    if (!taskIds && !confirm(`Áp dụng đề xuất của AI cho ${log.applicable_count} task?`)) return;
    setApplyingId(taskIds ? taskIds[0] : 'all');
    try {
      const res = await applyAICriteriaSuggestions(log.id, taskIds);
      if (res.success && res.data) {
        setLog(res.data.log);
        const failed = (res.data.results || []).filter((r: any) => !r.ok);
        if (failed.length) {
          alert(`Không áp dụng được ${failed.length} task:\n` + failed.map((f: any) => {
            const it = items.find(i => i.task_id === f.task_id);
            return `• ${it?.task_code ? '#' + it.task_code + ' ' : ''}${it?.detail || f.task_id}: ${f.error}`;
          }).join('\n'));
        }
        if (failed.length < (res.data.results || []).length) onTasksChanged?.();
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Không thể áp dụng đề xuất.');
    } finally {
      setApplyingId(null);
    }
  };
  const [log, setLog] = useState<CriteriaLog | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<'ALL' | 'ISSUE'>('ALL');

  const scopeKey = `${criterion}|${scope.entityType}|${scope.entityId}|${scope.projectId}|${scope.month}|${scope.year}`;

  useEffect(() => {
    setLog(null);
    if (!scope.entityId) return;
    getAICriteriaLatest(criterion, scope)
      .then(res => { if (res.success) setLog(res.data); })
      .catch(err => console.error('Error loading criteria review:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const handleRun = async () => {
    setLoading(true);
    try {
      const res = await runAICriteriaCheck(criterion, scope, criterion === 'SKILL' ? skillPrompt : undefined);
      if (res.success && res.data) setLog(res.data);
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.detail || 'Không thể thực hiện AI Review. Vui lòng kiểm tra lại prompt hoặc API Key.');
    } finally {
      setLoading(false);
    }
  };

  const items = log?.items || [];
  const counts = {
    OK: items.filter(i => i.verdict === 'OK').length,
    WARNING: items.filter(i => i.verdict === 'WARNING').length,
    WRONG: items.filter(i => i.verdict === 'WRONG').length,
  };
  const shown = verdictFilter === 'ALL' ? items : items.filter(i => i.verdict !== 'OK');
  const title = criterion === 'SKILL' ? 'Skill Area & Skill' : 'Manday EST';

  return (
    <div className="space-y-6 relative">
      {loading && (
        <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center z-20 rounded-xl min-h-[160px]">
          <div className="w-10 h-10 border-4 border-[#0058be] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-bold text-slate-600 mt-4 animate-pulse">AI đang đánh giá {title}...</p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Đánh giá {title}:</span>
            {log ? (
              <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                log.status === 'HAS_ISSUE' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {log.status === 'HAS_ISSUE' ? 'Có task chưa chuẩn' : 'Chuẩn'}
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 uppercase tracking-wider">Chưa kiểm tra</span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Phạm vi: {scopeText}</p>
          {log && (
            <p className="text-[11px] text-slate-400 mt-0.5 uppercase font-semibold">
              Lần cuối lúc: {new Date(log.checked_at).toLocaleString('vi-VN')}
            </p>
          )}
        </div>
        <button
          onClick={handleRun}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 active:scale-95 shrink-0 disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[16px]">psychology</span>
          Quét đánh giá {criterion === 'SKILL' ? 'Skill' : 'Manday'}
        </button>
      </div>

      {log ? (
        <>
          {(log.changed_count ?? 0) > 0 && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-xs text-sky-900 leading-relaxed">
                <b>{log.changed_count} task</b> đã được chỉnh sửa sau lần quét này — kết quả bên dưới có thể đã cũ.
              </p>
              <button
                onClick={handleRun}
                disabled={loading}
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white shrink-0 disabled:opacity-60"
              >
                Quét lại
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Điểm</span>
              <div className={`text-2xl font-black mt-1 ${log.score >= 80 ? 'text-emerald-600' : log.score >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{log.score}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Đạt</span>
              <div className="text-2xl font-black mt-1 text-emerald-600">{counts.OK}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cần xem lại</span>
              <div className="text-2xl font-black mt-1 text-amber-600">{counts.WARNING}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Chưa đúng</span>
              <div className="text-2xl font-black mt-1 text-rose-600">{counts.WRONG}</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">Đánh giá từng task ({items.length})</h4>
              <div className="flex items-center gap-2">
              {(log.applicable_count ?? 0) > 0 && (
                <button
                  onClick={() => handleApply()}
                  disabled={applyingId !== null}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                  {applyingId === 'all' ? 'Đang áp dụng...' : `Áp dụng tất cả (${log.applicable_count})`}
                </button>
              )}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-semibold">
                <button
                  onClick={() => setVerdictFilter('ALL')}
                  className={`px-2.5 py-1 ${verdictFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                >Tất cả</button>
                <button
                  onClick={() => setVerdictFilter('ISSUE')}
                  className={`px-2.5 py-1 ${verdictFilter === 'ISSUE' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                >Chưa chuẩn ({counts.WARNING + counts.WRONG})</button>
              </div>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {shown.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-8">Không có task nào.</p>
              ) : shown.map(item => {
                const clickable = !!onOpenTask && !item.deleted;
                return (
                <div
                  key={item.task_id}
                  onClick={clickable ? () => onOpenTask!(item.task_id) : undefined}
                  title={clickable ? 'Mở task này để chỉnh sửa' : undefined}
                  className={`p-4 space-y-1.5 ${clickable ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-800 leading-relaxed min-w-0">
                      {item.task_code && <span className="text-slate-400 font-mono mr-1.5">#{item.task_code}</span>}
                      {item.detail}
                      {clickable && <span className="material-symbols-outlined text-[13px] text-slate-400 align-middle ml-1">open_in_new</span>}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.applied ? (
                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-100 text-emerald-800">✓ Đã áp dụng đề xuất</span>
                      ) : item.changed && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-sky-100 text-sky-800">
                          {item.deleted ? 'Đã xoá' : 'Đã sửa – cần quét lại'}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${VERDICT_STYLE[item.verdict]?.cls || ''} ${item.changed ? 'opacity-50' : ''}`}>
                        {VERDICT_STYLE[item.verdict]?.label || item.verdict}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-0.5">
                    {criterion === 'SKILL' ? (
                      <>
                        <span>Skill Area: <b className="text-slate-700">{item.skill_area || '—'}</b></span>
                        <span>Skill: <b className="text-slate-700">{item.skill || '—'}</b></span>
                      </>
                    ) : (
                      <>
                        <span>Manday EST: <b className="text-slate-700">{item.manday_est ?? '—'}</b></span>
                        {item.manday_actual != null && <span>Manday Actual: <b className="text-slate-700">{item.manday_actual}</b></span>}
                        {item.status && <span>Trạng thái: {item.status}</span>}
                      </>
                    )}
                    {item.assigned && <span>Assigned: {item.assigned}</span>}
                  </div>
                  {item.reason && <p className="text-[11px] text-slate-600 leading-relaxed">{item.reason}</p>}
                  {item.verdict !== 'OK' && criterion === 'SKILL' && (item.suggested_skill_area || item.suggested_skill) && (
                    <p className="text-[11px] text-indigo-700 font-semibold">
                      → Đề xuất: {item.suggested_skill_area || item.skill_area || '—'} / {item.suggested_skill || '—'}
                    </p>
                  )}
                  {item.verdict !== 'OK' && criterion === 'MANDAY' && item.suggested_manday != null && (
                    <p className="text-[11px] text-indigo-700 font-semibold">→ Manday đề xuất: {item.suggested_manday}</p>
                  )}
                  {item.applicable && (
                    <button
                      onClick={e => { e.stopPropagation(); handleApply([item.task_id]); }}
                      disabled={applyingId !== null}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                      {applyingId === item.task_id ? 'Đang áp dụng...' : 'Áp dụng đề xuất'}
                    </button>
                  )}
                  {item.changed && !item.deleted && !item.applied && (
                    <p className="text-[11px] text-sky-700 font-semibold">
                      ✎ Hiện tại: {criterion === 'SKILL'
                        ? `${item.current_skill_area || '—'} / ${item.current_skill || '—'}`
                        : `Manday EST ${item.current_manday_est ?? '—'}`}
                    </p>
                  )}
                </div>
                );
              })}
            </div>
          </div>

          {log.suggestions.length > 0 && (
            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider">Đề xuất chung ({log.suggestions.length})</h4>
              <ul className="space-y-2">
                {log.suggestions.map((s, idx) => (
                  <li key={idx} className="text-xs text-amber-950 flex items-start gap-2 leading-relaxed">
                    <span className="text-amber-500 font-bold shrink-0 mt-0.5">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {log.result_markdown && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2.5">Nhận xét tổng quan</h4>
              <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-medium">{log.result_markdown}</div>
            </div>
          )}

          {log.prompt_snapshot && (
            <details className="group bg-slate-100 border border-slate-200 rounded-xl p-4">
              <summary className="text-[10px] font-bold text-slate-500 uppercase tracking-wider cursor-pointer list-none flex items-center justify-between select-none">
                <span>🔍 Prompt đã dùng cho lần quét này</span>
                <span className="transition-transform group-open:rotate-180">▼</span>
              </summary>
              <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-600 font-mono whitespace-pre-wrap overflow-x-auto">
                {log.prompt_snapshot}
              </div>
            </details>
          )}
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-10 shadow-sm text-center">
          <span className="material-symbols-outlined text-[48px] text-slate-300">fact_check</span>
          <h3 className="text-sm font-bold text-slate-700 mt-4">Chưa có kết quả đánh giá {title}</h3>
          <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
            Bấm "Quét đánh giá {criterion === 'SKILL' ? 'Skill' : 'Manday'}" để AI kiểm tra từng task trong phạm vi trên.
          </p>
        </div>
      )}
    </div>
  );
}
