import React from 'react';
import AIReviewPanel from '@/components/AIReviewPanel';

interface AIReviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'PROJECT' | 'PHASE' | 'TASK' | 'MEMBER';
  entityId: number;
  entityName: string;
  onSuccessCheck?: () => void;
  // Required for entityType 'MEMBER' only — a member has no project of
  // their own, so the review must say which project's tasks to scope to.
  projectId?: number;
  // When a member-scoping context is active (drilled in from /kpi), offer
  // an extra tab beside "Báo Cáo Hiện Tại" for that one person's own report.
  memberTab?: { memberId: number; memberName: string; projectId: number };
  contextProjectId?: number;
  // Month/year scope for the Skill/Manday criteria tabs (from /kpi).
  period?: { month?: number; year?: number };
  onOpenTask?: (taskId: number) => void;
}

export default function AIReviewDrawer({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityName,
  onSuccessCheck,
  projectId,
  memberTab,
  contextProjectId,
  period,
  onOpenTask,
}: AIReviewDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 transition-opacity duration-300"
      />

      {/* Drawer Body */}
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col z-10 transition-transform duration-300 animate-slide-in">

        {/* Drawer Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-[#0058be] text-white tracking-wider">
                {entityType === 'PROJECT' ? 'Dự án' : entityType === 'PHASE' ? 'Giai đoạn' : entityType === 'MEMBER' ? 'Thành viên' : 'Công việc'}
              </span>
              <span className="text-slate-400 text-xs">•</span>
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">AI Quality Check</span>
            </div>
            <h2 className="text-base font-bold text-[#0f172a] truncate max-w-[450px] mt-1">
              {entityName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-200/50 rounded-lg transition-all"
          >
            <span className="material-symbols-outlined text-[20px] block">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 bg-slate-50/50">
          <AIReviewPanel
            entityType={entityType}
            entityId={entityId}
            entityName={entityName}
            projectId={projectId}
            memberTab={memberTab}
            contextProjectId={contextProjectId}
            period={period}
            onOpenTask={onOpenTask}
            onSuccessCheck={onSuccessCheck}
          />
        </div>
      </div>
    </div>
  );
}
