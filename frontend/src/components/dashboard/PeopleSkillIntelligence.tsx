'use client';

// People & Skill Intelligence — tab Dashboard cạnh Team Load. Tìm đúng
// người theo Skill cho 1 dự án, xem hồ sơ 360 (KPI, skill, tải công việc),
// và mượn/trả người giữa các dự án (Project Skill).
//
// Cấu trúc: 2 tab nhỏ — "Hồ sơ nhân sự & Skill Directory" (gộp 1 tab, có
// switch nội bộ Hồ sơ nhân sự ⇄ Skill Directory giống đúng file HTML mẫu
// markee_kpi_people_skills_profile360_v3.html) và "Project Skill".
//
// Dữ liệu tái dùng 100% từ những chỗ đã có, không tự bịa công thức mới:
// - Giao% (tải công việc, không đổi dù Done hay chưa) — y hệt Team Load,
//   từ GET /system-audit/team-comparison (chỉ Leader/Super Admin gọi được).
// - "Việc đang mở" (task CHƯA Done) + "Dự án hiện tại" — tính từ GET
//   /system-audit/team-comparison-tasks (cùng nguồn Team Load dùng cho
//   MemberDetailModal).
// - Hồ sơ chi tiết khi bấm vào 1 người: tái dùng thẳng MemberDetailModal.
import { useEffect, useMemo, useState } from 'react';
import { Users, Search, Loader2, Sparkles, Briefcase, ChevronRight, Send, Check, X } from 'lucide-react';
import { isAdmin } from '@/lib/auth';
import {
  getMembers, getTeamComparison, getTeamComparisonTasks, getCategories, getProjects,
  getEligibleLoanMembers, createMemberLoanRequest, getMemberLoanRequests, respondMemberLoanRequest,
  TeamComparisonMember, WorkloadSetting, MemberLoanRequest,
} from '@/lib/api';
import MemberDetailModal from '@/components/dashboard/MemberDetailModal';

type MainTab = 'people-skill' | 'project-skill';
type PeopleView = 'people' | 'skills';

interface SkillNode { id: number; name: string; group_id: number; is_active?: boolean; is_used?: boolean; }
interface GroupNode { id: number; name: string; category_id: number; is_used?: boolean; skills: SkillNode[]; }
interface CategoryNode { id: number; name: string; is_active?: boolean; is_used?: boolean; groups: GroupNode[]; }

function initials(name: string) {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function classifyPct(pct: number, settings: WorkloadSetting[]): { key: string; label: string; tone: string } {
  if (settings.length === 4) {
    const sorted = [...settings].sort((a, b) => (a.min_kpi ?? 0) - (b.min_kpi ?? 0));
    for (const ws of sorted) {
      const lo = ws.min_kpi ?? -Infinity;
      const hi = ws.max_kpi ?? Infinity;
      if (pct >= lo && pct <= hi) return toneFor(ws.status_key, ws.status_label);
    }
  }
  if (pct > 120) return toneFor('overload', 'Quá tải');
  if (pct >= 90) return toneFor('normal', 'Bình thường');
  if (pct >= 50) return toneFor('capacity', 'Còn capacity');
  return toneFor('not_working', 'Không làm việc');
}
function toneFor(key: string, label: string) {
  const tones: Record<string, string> = {
    overload: 'bg-rose-50 text-rose-700 border-rose-200',
    normal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    capacity: 'bg-blue-50 text-blue-700 border-blue-200',
    not_working: 'bg-slate-100 text-slate-500 border-slate-200',
  };
  return { key, label, tone: tones[key] || tones.not_working };
}

const OPEN_STATUSES_EXCLUDE = new Set(['done', 'cancel']);
const LOAN_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Đang chờ', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  accepted: { label: 'Đã đồng ý', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Đã từ chối', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export default function PeopleSkillIntelligence() {
  const admin = isAdmin();
  const [mainTab, setMainTab] = useState<MainTab>(admin ? 'people-skill' : 'project-skill');
  const [peopleView, setPeopleView] = useState<PeopleView>('people');

  // ── Dữ liệu dùng chung (chỉ Leader/Super Admin) ──
  const [members, setMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [giaoMap, setGiaoMap] = useState<Map<number, number>>(new Map());
  const [workloadSettings, setWorkloadSettings] = useState<WorkloadSetting[]>([]);
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [allProjects, setAllProjects] = useState<{ id: any; name: string }[]>([]);
  const [selectedMemberModal, setSelectedMemberModal] = useState<any | null>(null);

  const [shortlist, setShortlist] = useState<{ id: number; name: string; team?: string | null }[]>([]);
  const isShortlisted = (id: number) => shortlist.some((s) => s.id === id);
  function toggleShortlist(entry: { id: number; name: string; team?: string | null }) {
    setShortlist((prev) => (prev.some((s) => s.id === entry.id) ? prev.filter((s) => s.id !== entry.id) : [...prev, entry]));
  }
  const [shortlistProjectId, setShortlistProjectId] = useState<number | ''>('');
  const [sendingShortlist, setSendingShortlist] = useState(false);
  const [shortlistError, setShortlistError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    setMembersLoading(true);
    Promise.all([
      getMembers({ light: true }).catch(() => []),
      getTeamComparison({}).catch(() => null),
      getTeamComparisonTasks().catch(() => []),
      getProjects().catch(() => []),
      getEligibleLoanMembers(true).catch(() => []),
    ]).then(([mem, cmp, tasks, projects, eligible]) => {
      setLoanProjects(Array.isArray(projects) ? projects : []);
      setEligibleMembers(Array.isArray(eligible) ? eligible : []);
      setMembers(Array.isArray(mem) ? mem : []);
      const map = new Map<number, number>();
      if (cmp?.teams) {
        for (const t of cmp.teams) {
          for (const m of t.members || []) map.set(m.member_id, m.giao_pct ?? 0);
        }
      }
      setGiaoMap(map);
      setWorkloadSettings(cmp?.workload_settings || []);
      const taskList = Array.isArray(tasks) ? tasks : [];
      setAllTasks(taskList);
      const projMap = new Map<string, { id: any; name: string }>();
      for (const t of taskList) {
        if (t.project_id == null) continue;
        const key = String(t.project_id);
        if (!projMap.has(key)) projMap.set(key, { id: t.project_id, name: t.projectName || `Project #${t.project_id}` });
      }
      setAllProjects(Array.from(projMap.values()));
    }).finally(() => setMembersLoading(false));
  }, [admin]);

  const openTaskCountByMember = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of allTasks) {
      const status = (t.status || '').toLowerCase();
      if (OPEN_STATUSES_EXCLUDE.has(status)) continue;
      for (const key of [t.assigned_id, t.support_id]) {
        if (key == null) continue;
        map.set(Number(key), (map.get(Number(key)) || 0) + 1);
      }
    }
    return map;
  }, [allTasks]);

  // "Dự án hiện tại" — dự án có nhiều task đang mở nhất cho người đó (tie-break
  // bằng task có start_date gần nhất); "N dự án đang/đã tham gia" — tổng số dự
  // án khác nhau người đó có task (bất kể trạng thái).
  const currentProjectByMember = useMemo(() => {
    const perMember = new Map<number, Map<string, { name: string; openCount: number; latest: string }>>();
    for (const t of allTasks) {
      if (t.project_id == null) continue;
      for (const key of [t.assigned_id, t.support_id]) {
        if (key == null) continue;
        const mid = Number(key);
        if (!perMember.has(mid)) perMember.set(mid, new Map());
        const projMap = perMember.get(mid)!;
        const pkey = String(t.project_id);
        const status = (t.status || '').toLowerCase();
        const isOpen = !OPEN_STATUSES_EXCLUDE.has(status);
        const existing = projMap.get(pkey) || { name: t.projectName || `Project #${t.project_id}`, openCount: 0, latest: '' };
        if (isOpen) existing.openCount += 1;
        const d = t.start_date || t.end_date_est || '';
        if (d > existing.latest) existing.latest = d;
        projMap.set(pkey, existing);
      }
    }
    const result = new Map<number, { name: string; totalProjects: number }>();
    Array.from(perMember.entries()).forEach(([mid, projMap]) => {
      const entries = Array.from(projMap.values());
      entries.sort((a, b) => (b.openCount - a.openCount) || (b.latest > a.latest ? 1 : -1));
      result.set(mid, { name: entries[0]?.name || '—', totalProjects: entries.length });
    });
    return result;
  }, [allTasks]);

  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const teamOptions = useMemo(() => Array.from(new Set(members.map(m => m.team).filter(Boolean))).sort(), [members]);
  const deptOptions = useMemo(() => Array.from(new Set(members.map(m => m.department).filter(Boolean))).sort(), [members]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter(m => {
      if (teamFilter && m.team !== teamFilter) return false;
      if (deptFilter && m.department !== deptFilter) return false;
      if (!q) return true;
      const hay = [m.display_name, m.full_name, m.team, m.department, ...(m.skills || []).map((s: any) => s.name)].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [members, search, teamFilter, deptFilter]);

  function openMemberProfile(m: any) {
    setSelectedMemberModal({
      id: m.id,
      name: m.display_name,
      rawMember: {
        team: m.team || undefined,
        department: m.department || undefined,
        leader_name: m.leader_name || undefined,
        display_name: m.display_name,
        full_name: m.full_name,
      },
    });
  }

  // ── Skill Directory ──────────────────────────────────────────────────
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillNode | null>(null);
  const [skillCandidates, setSkillCandidates] = useState<any[]>([]);
  const [skillCandidatesLoading, setSkillCandidatesLoading] = useState(false);

  useEffect(() => {
    if (peopleView !== 'skills' || !admin) return;
    if (categories.length > 0) return;
    setCategoriesLoading(true);
    getCategories().then((data: CategoryNode[]) => {
      setCategories(Array.isArray(data) ? data : []);
      const firstUsed = (data || []).find(c => c.groups.some(g => g.skills.length > 0));
      if (firstUsed) setExpandedCategoryId(firstUsed.id);
    }).catch(() => setCategories([])).finally(() => setCategoriesLoading(false));
  }, [peopleView, admin, categories.length]);

  useEffect(() => {
    if (!selectedSkill) { setSkillCandidates([]); return; }
    setSkillCandidatesLoading(true);
    getMembers({ skill_id: selectedSkill.id })
      .then((data: any[]) => setSkillCandidates(Array.isArray(data) ? data.sort((a, b) => (b.kpi_total || 0) - (a.kpi_total || 0)) : []))
      .catch(() => setSkillCandidates([]))
      .finally(() => setSkillCandidatesLoading(false));
  }, [selectedSkill]);

  // ── Project Skill — mượn/trả người ──────────────────────────────────
  const [loanProjects, setLoanProjects] = useState<any[]>([]);
  const [eligibleMembers, setEligibleMembers] = useState<any[]>([]);
  const [loanProjectId, setLoanProjectId] = useState<number | ''>('');
  const [loanMemberId, setLoanMemberId] = useState<number | ''>('');
  const [loanMessage, setLoanMessage] = useState('');
  const [sendingLoan, setSendingLoan] = useState(false);
  const [loanError, setLoanError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<MemberLoanRequest[]>([]);
  const [outgoing, setOutgoing] = useState<MemberLoanRequest[]>([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<number, string>>({});

  function loadLoans() {
    setLoansLoading(true);
    Promise.all([
      getMemberLoanRequests('incoming').catch(() => []),
      admin ? getMemberLoanRequests('outgoing').catch(() => []) : Promise.resolve([]),
    ]).then(([inc, out]) => {
      setIncoming(inc);
      setOutgoing(out);
    }).finally(() => setLoansLoading(false));
  }

  useEffect(() => {
    if (mainTab !== 'project-skill') return;
    loadLoans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  async function handleSendShortlist() {
    if (!shortlistProjectId || shortlist.length === 0) return;
    setSendingShortlist(true);
    setShortlistError(null);
    const failures: string[] = [];
    for (const m of shortlist) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await createMemberLoanRequest(Number(shortlistProjectId), m.id);
      } catch (e: any) {
        failures.push(`${m.name}: ${e?.response?.data?.detail || 'lỗi'}`);
      }
    }
    setShortlist([]);
    setShortlistProjectId('');
    loadLoans();
    setShortlistError(failures.length ? failures.join('; ') : null);
    setSendingShortlist(false);
  }

  async function handleSendLoan() {
    if (!loanProjectId || !loanMemberId) return;
    setSendingLoan(true);
    setLoanError(null);
    try {
      await createMemberLoanRequest(Number(loanProjectId), Number(loanMemberId), loanMessage.trim() || undefined);
      setLoanMessage('');
      setLoanMemberId('');
      loadLoans();
    } catch (e: any) {
      setLoanError(e?.response?.data?.detail || 'Gửi yêu cầu thất bại');
    } finally {
      setSendingLoan(false);
    }
  }

  async function handleRespond(loanId: number, decision: 'accepted' | 'rejected') {
    setRespondingId(loanId);
    try {
      await respondMemberLoanRequest(loanId, decision, reasonDraft[loanId]?.trim() || undefined);
      loadLoans();
    } finally {
      setRespondingId(null);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-1 border-b border-slate-200">
        {admin && (
          <button
            onClick={() => setMainTab('people-skill')}
            className={`px-3.5 py-2 text-[13px] font-bold border-b-2 transition-colors ${mainTab === 'people-skill' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            Hồ sơ nhân sự &amp; Skill Directory
          </button>
        )}
        <button
          onClick={() => setMainTab('project-skill')}
          className={`px-3.5 py-2 text-[13px] font-bold border-b-2 transition-colors ${mainTab === 'project-skill' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          Project Skill
        </button>
      </div>

      {mainTab === 'people-skill' && admin && (
        <div className="space-y-4">
          <div className="inline-flex bg-slate-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setPeopleView('people')}
              className={`px-3.5 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${peopleView === 'people' ? 'bg-white text-[#0058be] shadow-sm' : 'text-slate-500'}`}
            >
              Hồ sơ nhân sự
            </button>
            <button
              onClick={() => setPeopleView('skills')}
              className={`px-3.5 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${peopleView === 'skills' ? 'bg-white text-[#0058be] shadow-sm' : 'text-slate-500'}`}
            >
              Skill Directory
            </button>
          </div>

          {shortlist.length > 0 && (
            <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-[12.5px] font-extrabold text-indigo-700">🌟 Shortlist ({shortlist.length})</h4>
                <button onClick={() => setShortlist([])} className="text-[11px] text-slate-400 hover:text-slate-600">Xóa hết</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {shortlist.map((s) => (
                  <span key={s.id} className="flex items-center gap-1 text-[11px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-1 rounded-full">
                    {s.name}
                    <button onClick={() => toggleShortlist(s)} className="text-indigo-400 hover:text-indigo-700">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={shortlistProjectId}
                  onChange={(e) => setShortlistProjectId(e.target.value ? Number(e.target.value) : '')}
                  className="text-[12px] bg-white border border-indigo-200 rounded-lg px-2.5 py-1.5 outline-none"
                >
                  <option value="">-- Chọn dự án để mượn --</option>
                  {loanProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button
                  onClick={handleSendShortlist}
                  disabled={!shortlistProjectId || sendingShortlist}
                  className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {sendingShortlist ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Gửi yêu cầu mượn cho {shortlist.length} người
                </button>
              </div>
              {shortlistError && <p className="text-[11px] text-red-600">{shortlistError}</p>}
            </div>
          )}

          {peopleView === 'people' && (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm tên, team, hoặc skill..."
                    className="w-full pl-8 pr-3 py-1.5 text-[12.5px] bg-white text-slate-800 placeholder:text-slate-400 border border-slate-300 rounded-full outline-none focus:ring-1 focus:ring-[#0058be]"
                  />
                </div>
                <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}
                  className="text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
                  <option value="">Tất cả team</option>
                  {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                  className="text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
                  <option value="">Tất cả phòng ban</option>
                  {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <span className="text-[11.5px] text-slate-400 font-semibold ml-auto">{filteredMembers.length} người</span>
              </div>

              {membersLoading ? (
                <div className="flex items-center justify-center py-14 text-slate-400 gap-2 text-[12.5px]">
                  <Loader2 className="w-4 h-4 animate-spin" /> Đang tải...
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                        <th className="text-left px-4 py-2.5">Nhân sự</th>
                        <th className="text-left px-4 py-2.5">Skill nổi bật</th>
                        <th className="text-left px-4 py-2.5">Dự án hiện tại</th>
                        <th className="text-right px-4 py-2.5">Tải công việc (Giao%)</th>
                        <th className="text-right px-4 py-2.5">Việc đang mở</th>
                        <th className="text-right px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.map((m) => {
                        const giao = giaoMap.get(m.id) ?? 0;
                        const badge = classifyPct(giao, workloadSettings);
                        const openCount = openTaskCountByMember.get(m.id) || 0;
                        const proj = currentProjectByMember.get(m.id);
                        return (
                          <tr key={m.id} onClick={() => openMemberProfile(m)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[11px] flex items-center justify-center shrink-0">{initials(m.display_name)}</div>
                                <div>
                                  <div className="font-bold text-slate-800">{m.display_name}</div>
                                  <div className="text-[11px] text-slate-400">{[m.team, m.department].filter(Boolean).join(' · ')}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {(m.skills || []).slice(0, 3).map((s: any) => (
                                  <span key={s.id} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{s.name}</span>
                                ))}
                                {(m.skills || []).length > 3 && <span className="text-[10px] text-slate-400">+{m.skills.length - 3}</span>}
                                {(m.skills || []).length === 0 && <span className="text-[11px] text-slate-300">—</span>}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="font-bold text-slate-800">{proj?.name || '—'}</div>
                              <div className="text-[11px] text-slate-400">{proj ? `${proj.totalProjects} dự án đang/đã tham gia` : 'Chưa có task'}</div>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${badge.tone}`}>{giao.toFixed(0)}% · {badge.label}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-slate-700">{openCount === 0 ? <span className="text-emerald-600">Rảnh</span> : openCount}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleShortlist({ id: m.id, name: m.display_name, team: m.team }); }}
                                className={`text-[10.5px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap transition-colors ${
                                  isShortlisted(m.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                                }`}
                              >
                                {isShortlisted(m.id) ? '✓ Đã thêm' : '+ Shortlist'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredMembers.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-12 text-slate-400">Không tìm thấy nhân sự phù hợp.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {peopleView === 'skills' && (
            <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1 max-h-[70vh] overflow-y-auto">
                {categoriesLoading ? (
                  <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-[12px]"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải...</div>
                ) : categories.map((c) => (
                  <div key={c.id}>
                    <button
                      onClick={() => setExpandedCategoryId(expandedCategoryId === c.id ? null : c.id)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-1.5"><ChevronRight className={`w-3.5 h-3.5 transition-transform ${expandedCategoryId === c.id ? 'rotate-90' : ''}`} />{c.name}</span>
                    </button>
                    {expandedCategoryId === c.id && (
                      <div className="pl-6 space-y-0.5 pb-1">
                        {c.groups.flatMap((g) => g.skills).map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setSelectedSkill(s)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] ${selectedSkill?.id === s.id ? 'bg-[#0058be] text-white font-bold' : 'text-slate-500 hover:bg-slate-50'}`}
                          >
                            {s.name}
                          </button>
                        ))}
                        {c.groups.every(g => g.skills.length === 0) && <div className="text-[11px] text-slate-300 px-2.5 py-1">Chưa có skill nào</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                {!selectedSkill ? (
                  <div className="text-center py-16 text-[12.5px] text-slate-400">
                    <Sparkles className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    Chọn 1 Skill bên trái để xem ai đang có skill đó.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-extrabold text-slate-800">{selectedSkill.name}</h3>
                        <p className="text-[11.5px] text-slate-400">{skillCandidates.length} người có skill này · xếp theo Tổng KPI đã hoàn thành</p>
                      </div>
                    </div>
                    {skillCandidatesLoading ? (
                      <div className="flex items-center justify-center py-10 text-slate-400 gap-2 text-[12.5px]"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải...</div>
                    ) : (
                      <div className="space-y-2">
                        {skillCandidates.map((m) => {
                          const openCount = openTaskCountByMember.get(m.id) || 0;
                          return (
                            <div key={m.id} onClick={() => openMemberProfile(m)} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2.5 hover:border-[#0058be] cursor-pointer transition-colors">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[11px] flex items-center justify-center shrink-0">{initials(m.display_name)}</div>
                                <div>
                                  <div className="font-bold text-slate-800 text-[12.5px]">{m.display_name}</div>
                                  <div className="text-[11px] text-slate-400">{[m.team, m.department].filter(Boolean).join(' · ')}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[12.5px] font-extrabold text-[#0058be]">{Number(m.kpi_total || 0).toFixed(1)}</div>
                                <div className="text-[10.5px] text-slate-400">{openCount === 0 ? 'Rảnh' : `${openCount} việc đang mở`}</div>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleShortlist({ id: m.id, name: m.display_name, team: m.team }); }}
                                className={`shrink-0 text-[10.5px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap transition-colors ${
                                  isShortlisted(m.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                                }`}
                              >
                                {isShortlisted(m.id) ? '✓ Đã thêm' : '+ Shortlist'}
                              </button>
                            </div>
                          );
                        })}
                        {skillCandidates.length === 0 && <div className="text-center py-10 text-slate-400 text-[12.5px]">Chưa có ai được gắn skill này.</div>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {mainTab === 'project-skill' && (
        <div className="space-y-4">
          {admin && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-[13px] font-extrabold text-slate-800 flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-[#0058be]" /> Mượn người cho dự án
              </h3>
              <p className="text-[11.5px] text-slate-400">Chỉ chọn được người ở team khác — mượn người trong chính team mình thì giao việc trực tiếp, không cần qua đây.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <select value={loanProjectId} onChange={(e) => setLoanProjectId(e.target.value ? Number(e.target.value) : '')}
                  className="text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
                  <option value="">-- Chọn dự án --</option>
                  {loanProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={loanMemberId} onChange={(e) => setLoanMemberId(e.target.value ? Number(e.target.value) : '')}
                  className="text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]">
                  <option value="">-- Chọn người muốn mượn --</option>
                  {eligibleMembers.map((m: any) => <option key={m.id} value={m.id}>{m.display_name}{m.team ? ` (${m.team})` : ''}</option>)}
                </select>
                <input
                  value={loanMessage}
                  onChange={(e) => setLoanMessage(e.target.value)}
                  placeholder="Lý do / ghi chú (không bắt buộc)"
                  className="text-[12.5px] bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]"
                />
              </div>
              {loanError && <p className="text-[11.5px] text-red-600">{loanError}</p>}
              <button
                onClick={handleSendLoan}
                disabled={!loanProjectId || !loanMemberId || sendingLoan}
                className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#0058be] hover:bg-[#0047a0] disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
              >
                {sendingLoan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Gửi yêu cầu mượn
              </button>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
            <h3 className="text-[13px] font-extrabold text-slate-800">Yêu cầu liên quan đến bạn</h3>
            {loansLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-[12.5px]"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải...</div>
            ) : incoming.length === 0 ? (
              <p className="text-[12px] text-slate-400 py-4 text-center">Chưa có ai gửi yêu cầu mượn bạn.</p>
            ) : (
              incoming.map((loan) => {
                const st = LOAN_STATUS_LABEL[loan.status];
                return (
                  <div key={loan.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[12.5px] font-bold text-slate-800">{loan.requested_by_name || 'Một Leader'} muốn mượn bạn cho dự án <span className="text-[#0058be]">{loan.project_name}</span></div>
                        {loan.message && <div className="text-[11px] text-slate-400 mt-0.5">"{loan.message}"</div>}
                      </div>
                      <span className={`shrink-0 text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${st.tone}`}>{st.label}</span>
                    </div>
                    {loan.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <input
                          value={reasonDraft[loan.id] || ''}
                          onChange={(e) => setReasonDraft((prev) => ({ ...prev, [loan.id]: e.target.value }))}
                          placeholder="Lý do (không bắt buộc)"
                          className="flex-1 text-[11.5px] border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[#0058be]"
                        />
                        <button
                          onClick={() => handleRespond(loan.id, 'accepted')}
                          disabled={respondingId === loan.id}
                          className="flex items-center gap-1 text-[11.5px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg"
                        >
                          <Check className="w-3.5 h-3.5" /> Đồng ý
                        </button>
                        <button
                          onClick={() => handleRespond(loan.id, 'rejected')}
                          disabled={respondingId === loan.id}
                          className="flex items-center gap-1 text-[11.5px] font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg"
                        >
                          <X className="w-3.5 h-3.5" /> Từ chối
                        </button>
                      </div>
                    )}
                    {loan.reason && loan.status !== 'pending' && (
                      <div className="text-[11px] text-slate-400">Lý do trả lời: {loan.reason}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {admin && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
              <h3 className="text-[13px] font-extrabold text-slate-800">Yêu cầu đã gửi</h3>
              {outgoing.length === 0 ? (
                <p className="text-[12px] text-slate-400 py-4 text-center">Bạn chưa gửi yêu cầu mượn người nào.</p>
              ) : (
                outgoing.map((loan) => {
                  const st = LOAN_STATUS_LABEL[loan.status];
                  return (
                    <div key={loan.id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-2">
                      <div className="text-[12.5px] font-bold text-slate-800">
                        Mượn <span className="text-[#0058be]">{loan.member_name}</span> cho dự án {loan.project_name}
                      </div>
                      <span className={`shrink-0 text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${st.tone}`}>{st.label}</span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {selectedMemberModal && (
        <MemberDetailModal
          member={selectedMemberModal}
          tasks={allTasks}
          projects={allProjects}
          onClose={() => setSelectedMemberModal(null)}
          onNavigate={(projectId) => { setSelectedMemberModal(null); window.location.href = `/project/detail/overview?id=${projectId}`; }}
          selectedYear="all"
          selectedMonth="all"
          selectedWeek="all"
          activeQuickFilter={null}
          onApplyQuickFilter={() => {}}
          onYearChange={() => {}}
          onMonthChange={() => {}}
          onWeekChange={() => {}}
        />
      )}
    </div>
  );
}
