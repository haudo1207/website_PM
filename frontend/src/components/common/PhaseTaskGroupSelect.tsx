'use client';

import React, { useState, useEffect } from 'react';
import { getPhases, createPhase, getTaskGroups, createTaskGroup } from '@/lib/api';

export interface PickedRef { id: number; name: string; }

// Per-task Phase + "Task cha" (TaskGroup) pickers — shared between
// MeetingDetailModal's AI task table and WipLogDetailModal's AI task cards.
// Both include a "+ Tạo mới" option that reveals an inline text input — if
// the project doesn't have the right Phase/Task cha yet, the user can create
// it right here instead of leaving the current screen.
const NEW_PHASE = '__new_phase__';
const NEW_GROUP = '__new_group__';

export function PhaseSelectCell({
  projectId,
  phase,
  onPhaseChange,
  onTaskGroupChange,
}: {
  projectId?: number | string;
  phase?: PickedRef;
  onPhaseChange: (p: PickedRef | undefined) => void;
  onTaskGroupChange: (tg: PickedRef | undefined) => void;
}) {
  const [phases, setPhases] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPhases([]);
    if (!projectId) return;
    getPhases(Number(projectId)).then((res: any) => setPhases(Array.isArray(res) ? res : (res?.data || []))).catch(() => setPhases([]));
  }, [projectId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !projectId) return;
    setBusy(true);
    try {
      const ph = await createPhase(Number(projectId), { name });
      setPhases(prev => [...prev, ph]);
      onPhaseChange({ id: ph.id, name: ph.name });
      onTaskGroupChange(undefined);
      setNewName('');
      setCreating(false);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không tạo được Phase mới');
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
          placeholder="Tên phase mới..."
          disabled={busy}
          className="w-24 px-2 py-1 text-xs border border-[#cbd5e1] rounded-lg focus:outline-none focus:border-[#6366f1]"
        />
        <button type="button" onClick={handleCreate} disabled={busy} className="text-emerald-600 font-bold text-xs px-1">✓</button>
        <button type="button" onClick={() => setCreating(false)} disabled={busy} className="text-slate-400 font-bold text-xs px-1">✕</button>
      </div>
    );
  }

  return (
    <select
      disabled={!projectId}
      value={phase?.id || ''}
      onChange={e => {
        const val = e.target.value;
        if (val === NEW_PHASE) { setCreating(true); return; }
        const pid = Number(val);
        const found = phases.find((p: any) => p.id === pid);
        onPhaseChange(found ? { id: found.id, name: found.name } : undefined);
        onTaskGroupChange(undefined);
      }}
      className={`text-xs border rounded-lg px-2 py-1.5 bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:border-[#6366f1] w-full ${phase?.id ? 'border-[#cbd5e1]' : 'border-red-400'}`}
    >
      <option value="">-- Chọn phase --</option>
      {phases.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value={NEW_PHASE}>+ Tạo phase mới</option>
    </select>
  );
}

export function TaskGroupSelectCell({
  phase,
  taskGroup,
  onTaskGroupChange,
}: {
  phase?: PickedRef;
  taskGroup?: PickedRef;
  onTaskGroupChange: (tg: PickedRef | undefined) => void;
}) {
  const [groups, setGroups] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGroups([]);
    if (!phase?.id) return;
    getTaskGroups(phase.id).then((res: any) => setGroups(Array.isArray(res) ? res : (res?.data || []))).catch(() => setGroups([]));
  }, [phase?.id]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !phase?.id) return;
    setBusy(true);
    try {
      const tg = await createTaskGroup(phase.id, { name });
      setGroups(prev => [...prev, tg]);
      onTaskGroupChange({ id: tg.id, name: tg.name });
      setNewName('');
      setCreating(false);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Không tạo được Task cha mới');
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
          placeholder="Tên task cha mới..."
          disabled={busy}
          className="w-24 px-2 py-1 text-xs border border-[#cbd5e1] rounded-lg focus:outline-none focus:border-[#6366f1]"
        />
        <button type="button" onClick={handleCreate} disabled={busy} className="text-emerald-600 font-bold text-xs px-1">✓</button>
        <button type="button" onClick={() => setCreating(false)} disabled={busy} className="text-slate-400 font-bold text-xs px-1">✕</button>
      </div>
    );
  }

  return (
    <select
      disabled={!phase?.id}
      value={taskGroup?.id || ''}
      onChange={e => {
        const val = e.target.value;
        if (val === NEW_GROUP) { setCreating(true); return; }
        const gid = Number(val);
        const found = groups.find((g: any) => g.id === gid);
        onTaskGroupChange(found ? { id: found.id, name: found.name } : undefined);
      }}
      className={`text-xs border rounded-lg px-2 py-1.5 bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:border-[#6366f1] w-full ${taskGroup?.id ? 'border-[#cbd5e1]' : 'border-red-400'}`}
    >
      <option value="">-- Chọn task cha --</option>
      {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
      <option value={NEW_GROUP}>+ Tạo task cha mới</option>
    </select>
  );
}
