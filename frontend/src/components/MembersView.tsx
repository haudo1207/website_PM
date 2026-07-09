'use client';
import React, { useEffect, useState, useCallback } from 'react';
import {
  getMembers, createMember, updateMember, deleteMember,
  getTeams, getPositions, getDepartments, getCategories
} from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────
interface Skill { id: number; name: string; }
interface SkillGroup { groupName: string; categoryName: string; skills: Skill[]; }
interface Member {
  id: number;
  display_name: string;
  full_name: string;
  email?: string;
  telegram_username?: string;
  phone?: string;
  birth_date?: string;
  gender?: string;
  team?: string;
  position?: string;
  department?: string;
  experience_year?: number;
  skill_ids: number[];
  skills: Skill[];
}

const EMPTY_FORM = {
  display_name: '', full_name: '', email: '', telegram_username: '',
  phone: '', birth_date: '', gender: '', team: '', position: '',
  department: '', experience_year: 0, skill_ids: [] as number[]
};

interface Props {
  onFlash: (msg: string) => void;
}

export default function MembersView({ onFlash }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [allSkillGroups, setAllSkillGroups] = useState<SkillGroup[]>([]);
  const [allSkillsMap, setAllSkillsMap] = useState<Map<number, string>>(new Map());

  // filters
  const [search, setSearch] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');

  // modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // ─── Data loading ─────────────────────────────────────────────────
  const loadMembers = useCallback(() => {
    const params: any = {};
    if (search) params.search = search;
    if (filterTeam) params.team = filterTeam;
    if (filterPosition) params.position = filterPosition;
    if (filterDepartment) params.department = filterDepartment;
    getMembers(params).then(setMembers).catch(() => { });
  }, [search, filterTeam, filterPosition, filterDepartment]);

  useEffect(() => {
    loadMembers();
    getTeams().then(setTeams).catch(() => { });
    getPositions().then(setPositions).catch(() => { });
    getDepartments().then(setDepartments).catch(() => { });
    getCategories().then((cats: any[]) => {
      const groups: SkillGroup[] = [];
      const skillMap = new Map<number, string>();
      cats.forEach(cat => {
        (cat.groups || []).forEach((g: any) => {
          const activeSkills = (g.skills || []).filter((s: any) => s.is_active);
          if (activeSkills.length > 0) {
            groups.push({ categoryName: cat.name, groupName: g.name, skills: activeSkills });
            activeSkills.forEach((s: any) => skillMap.set(s.id, s.name));
          }
        });
      });
      setAllSkillGroups(groups);
      setAllSkillsMap(skillMap);
    }).catch(() => { });
  }, []);

  useEffect(() => {
    const t = setTimeout(loadMembers, 300);
    return () => clearTimeout(t);
  }, [loadMembers]);

  // ─── Modal helpers ────────────────────────────────────────────────
  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (m: Member) => {
    setEditingId(m.id);
    setForm({
      display_name: m.display_name,
      full_name: m.full_name,
      email: m.email || '',
      telegram_username: m.telegram_username || '',
      phone: m.phone || '',
      birth_date: m.birth_date || '',
      gender: m.gender || '',
      team: m.team || '',
      position: m.position || '',
      department: m.department || '',
      experience_year: m.experience_year || 0,
      skill_ids: m.skill_ids || [],
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await updateMember(editingId, form);
        onFlash('Đã cập nhật thành viên thành công');
      } else {
        await createMember(form);
        onFlash('Đã thêm thành viên thành công');
      }
      setShowModal(false);
      loadMembers();
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi lưu thành viên');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m: Member) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa thành viên "${m.display_name}"?`)) return;
    try {
      await deleteMember(m.id);
      onFlash('Đã xóa thành viên thành công');
      loadMembers();
    } catch (err: any) {
      onFlash(err.response?.data?.detail || 'Lỗi khi xóa thành viên');
    }
  };

  const toggleSkill = (id: number) => {
    setForm(f => ({
      ...f,
      skill_ids: f.skill_ids.includes(id)
        ? f.skill_ids.filter(s => s !== id)
        : [...f.skill_ids, id]
    }));
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Quản Lý Thành Viên</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý danh sách thành viên, kỹ năng và thông tin tổ chức</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Thêm thành viên
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Tìm kiếm theo tên hoặc Display Name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-[#0f172a] outline-none focus:border-blue-500 placeholder-slate-400"
          />
        </div>

        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0f172a] outline-none focus:border-blue-500 bg-white">
          <option value="">Tất cả Team</option>
          {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>

        <select value={filterPosition} onChange={e => setFilterPosition(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0f172a] outline-none focus:border-blue-500 bg-white">
          <option value="">Tất cả Chức vụ</option>
          {positions.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>

        <select value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0f172a] outline-none focus:border-blue-500 bg-white">
          <option value="">Tất cả Phòng ban</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>

        {(filterTeam || filterPosition || filterDepartment || search) && (
          <button onClick={() => { setSearch(''); setFilterTeam(''); setFilterPosition(''); setFilterDepartment(''); }}
            className="text-xs text-slate-500 hover:text-red-600 font-medium transition-colors">
            Xóa lọc
          </button>
        )}

        <span className="ml-auto text-[11px] text-slate-400 font-medium">{members.length} thành viên</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-[#0f172a]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-10">STT</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Display Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Họ tên</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Team</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Chức vụ</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Phòng ban</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Kỹ năng</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Telegram</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m, idx) => (
                <tr key={m.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 text-slate-400 font-medium">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px]">{m.display_name}</span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-[#0f172a]">{m.full_name}</td>
                  <td className="px-4 py-3">
                    {m.team && (
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-semibold">{m.team}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.position || <span className="text-slate-300">–</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{m.department || <span className="text-slate-300">–</span>}</td>
                  <td className="px-4 py-3">
                    {m.skills.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {m.skills.slice(0, 3).map(s => (
                          <span key={s.id} className="bg-emerald-50 text-emerald-700 text-[9px] px-1.5 py-0.5 rounded font-semibold">{s.name}</span>
                        ))}
                        {m.skills.length > 3 && (
                          <span className="text-[10px] text-slate-400 font-medium">+{m.skills.length - 3}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300 text-[10px]">Chưa có</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.telegram_username ? (
                      <span className="text-blue-500 text-[10px] font-medium">{m.telegram_username}</span>
                    ) : <span className="text-slate-300">–</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[10px]">
                    {m.email || <span className="text-slate-300">–</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(m)}
                        className="text-blue-600 hover:text-blue-700 font-semibold text-[11px]">Sửa</button>
                      <button onClick={() => handleDelete(m)}
                        className="text-red-500 hover:text-red-700 font-semibold text-[11px]">Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-slate-400 font-medium">
                    Không tìm thấy thành viên nào
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add / Edit */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto py-10">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider">
                {editingId ? 'Chỉnh sửa thành viên' : 'Thêm thành viên mới'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-700 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Section: Thông tin cá nhân */}
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="flex-1 border-t border-slate-100"></span>
                  Thông tin cá nhân
                  <span className="flex-1 border-t border-slate-100"></span>
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Display Name *</label>
                    <input required value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })}
                      placeholder="Ví dụ: 1.Minhpn"
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Họ và tên *</label>
                    <input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
                      placeholder="Ví dụ: Nguyễn Văn A"
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email</label>
                    <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                      placeholder="email@company.com"
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Telegram</label>
                    <input value={form.telegram_username} onChange={e => setForm({ ...form, telegram_username: e.target.value })}
                      placeholder="@username"
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Số điện thoại</label>
                    <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                      placeholder="0901234567"
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ngày sinh</label>
                    <input type="date" value={form.birth_date} onChange={e => setForm({ ...form, birth_date: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Giới tính</label>
                    <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all">
                      <option value="">-- Chọn --</option>
                      <option value="Nam">Nam</option>
                      <option value="Nữ">Nữ</option>
                      <option value="Khác">Khác</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Thông tin tổ chức */}
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="flex-1 border-t border-slate-100"></span>
                  Thông tin tổ chức
                  <span className="flex-1 border-t border-slate-100"></span>
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Team *</label>
                    <select required value={form.team} onChange={e => setForm({ ...form, team: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all">
                      <option value="">-- Chọn Team --</option>
                      {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Chức vụ</label>
                    <select value={form.position} onChange={e => setForm({ ...form, position: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all">
                      <option value="">-- Chọn chức vụ --</option>
                      {positions.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Phòng ban</label>
                    <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all">
                      <option value="">-- Chọn phòng ban --</option>
                      {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Kỹ năng */}
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="flex-1 border-t border-slate-100"></span>
                  Kỹ năng chuyên môn
                  <span className="flex-1 border-t border-slate-100"></span>
                </h3>

                <div className="flex items-center gap-4 mb-3">
                  <div className="flex flex-col gap-1 w-32">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Kinh nghiệm (năm)</label>
                    <input type="number" min={0} value={form.experience_year}
                      onChange={e => setForm({ ...form, experience_year: Number(e.target.value) })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 transition-all" />
                  </div>
                  {form.skill_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1 flex-1">
                      {form.skill_ids.map(sid => (
                        <span key={sid} className="bg-blue-50 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          {allSkillsMap.get(sid) || `#${sid}`}
                          <button type="button" onClick={() => toggleSkill(sid)} className="text-blue-400 hover:text-red-500">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {allSkillGroups.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Chưa có kỹ năng nào trong hệ thống.</p>
                ) : (
                  <div className="max-h-[200px] overflow-y-auto border border-slate-100 rounded-lg p-3 bg-slate-50/50 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {allSkillGroups.map(g => (
                      <div key={g.groupName + g.categoryName}>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          {g.categoryName} › {g.groupName}
                        </p>
                        {g.skills.map(s => (
                          <label key={s.id} className="flex items-center gap-1.5 cursor-pointer hover:text-blue-700 text-xs text-slate-600 py-0.5">
                            <input
                              type="checkbox"
                              checked={form.skill_ids.includes(s.id)}
                              onChange={() => toggleSkill(s.id)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all">
                  Hủy
                </button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all shadow-sm disabled:opacity-60 flex items-center gap-2">
                  {saving && <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
                  {editingId ? 'Lưu thay đổi' : 'Thêm thành viên'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
