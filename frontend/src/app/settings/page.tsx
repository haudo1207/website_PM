'use client';
import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import SystemCategoriesView from '@/components/SystemCategoriesView';
import MembersView from '@/components/MembersView';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  createGroup,
  updateGroup,
  deleteGroup,
  createSkill,
  updateSkill,
  deleteSkill,
  getPositions,
  createPosition,
  updatePosition,
  deletePosition,
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getPriorities,
  createPriority,
  updatePriority,
  deletePriority,
  getStatuses,
  createStatus,
  updateStatus,
  deleteStatus,
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam
} from '@/lib/api';

export default function SettingsPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [saved, setSaved] = useState('');
  const [activeTab, setActiveTab] = useState<'members' | 'skills' | 'system_categories'>('members');

  // Member Form
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'group_a', skills: [] as number[], position: '', department: '' });
  const [skillsModalUser, setSkillsModalUser] = useState<any | null>(null);
  const [userSkillsForm, setUserSkillsForm] = useState<number[]>([]);

  // Categories & Skills Master Data
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  // System Categories Data
  const [dbPositions, setDbPositions] = useState<any[]>([]);
  const [dbDepartments, setDbDepartments] = useState<any[]>([]);
  const [dbPriorities, setDbPriorities] = useState<any[]>([]);
  const [dbStatuses, setDbStatuses] = useState<any[]>([]);
  const [dbTeams, setDbTeams] = useState<any[]>([]);

  // Form states for creating master data
  const [newCatName, setNewCatName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newSkillName, setNewSkillName] = useState('');

  // Editing inline states
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState('');

  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  const [editingSkillId, setEditingSkillId] = useState<number | null>(null);
  const [editingSkillName, setEditingSkillName] = useState('');

  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (!isAdmin()) {
      router.push('/dashboard');
    } else {
      setAuthorized(true);
      getUsers().then(setUsers).catch(() => { });
      reloadCategories();
      reloadSystemCategories();
    }
  }, [router]);

  const reloadCategories = () => {
    getCategories()
      .then(data => {
        setCategories(data);
      })
      .catch(() => { });
  };

  const reloadSystemCategories = () => {
    getPositions().then(setDbPositions).catch(() => {});
    getDepartments().then(setDbDepartments).catch(() => {});
    getPriorities().then(setDbPriorities).catch(() => {});
    getStatuses().then(setDbStatuses).catch(() => {});
    getTeams().then(setDbTeams).catch(() => {});
  };

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(''), 5000);
  };

  // --- USER HANDLERS ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createUser(form);
      flash('Đã tạo tài khoản thành công');
      setForm({ email: '', full_name: '', password: '', role: 'group_a', skills: [], position: '', department: '' });
      getUsers().then(setUsers);
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi - Email có thể đã tồn tại');
    }
  };

  const handleOpenSkillsModal = (u: any) => {
    setSkillsModalUser(u);
    setUserSkillsForm(u.skills || []);
  };

  const handleSaveUserSkills = async () => {
    if (!skillsModalUser) return;
    try {
      await updateUser(skillsModalUser.id, { skills: userSkillsForm });
      flash('Đã cập nhật kỹ năng cho thành viên');
      setSkillsModalUser(null);
      getUsers().then(setUsers);
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi cập nhật kỹ năng');
    }
  };

  // --- CATEGORY CRUD ---
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await createCategory({ name: newCatName });
      setNewCatName('');
      reloadCategories();
      flash('Đã thêm Category thành công');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi thêm Category');
    }
  };

  const handleUpdateCategoryName = async (id: number) => {
    if (!editingCatName.trim()) return;
    try {
      await updateCategory(id, { name: editingCatName });
      setEditingCatId(null);
      reloadCategories();
      flash('Đã cập nhật Category');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi cập nhật Category');
    }
  };

  const handleToggleCategoryActive = async (cat: any) => {
    try {
      await updateCategory(cat.id, { is_active: !cat.is_active });
      reloadCategories();
      flash(`Đã ${!cat.is_active ? 'Kích hoạt' : 'Khóa'} Category`);
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi cập nhật Category');
    }
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa Category này? Tất cả các Group và Skill thuộc Category này cũng sẽ bị xóa.')) return;
    try {
      await deleteCategory(id);
      if (selectedCatId === id) {
        setSelectedCatId(null);
        setSelectedGroupId(null);
      }
      reloadCategories();
      flash('Đã xóa Category thành công');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi khi xóa Category');
    }
  };

  // --- GROUP CRUD ---
  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || !selectedCatId) return;
    try {
      await createGroup({ name: newGroupName, category_id: selectedCatId });
      setNewGroupName('');
      reloadCategories();
      flash('Đã thêm Group thành công');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi thêm Group');
    }
  };

  const handleUpdateGroupName = async (id: number) => {
    if (!editingGroupName.trim()) return;
    try {
      await updateGroup(id, { name: editingGroupName });
      setEditingGroupId(null);
      reloadCategories();
      flash('Đã cập nhật Group');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi cập nhật Group');
    }
  };

  const handleDeleteGroup = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa Group này? Tất cả các Skill thuộc Group này cũng sẽ bị xóa.')) return;
    try {
      await deleteGroup(id);
      if (selectedGroupId === id) {
        setSelectedGroupId(null);
      }
      reloadCategories();
      flash('Đã xóa Group thành công');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi khi xóa Group');
    }
  };

  // --- SKILL CRUD ---
  const handleAddSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkillName.trim() || !selectedGroupId) return;
    try {
      await createSkill({ name: newSkillName, group_id: selectedGroupId });
      setNewSkillName('');
      reloadCategories();
      flash('Đã thêm Skill thành công');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi thêm Skill');
    }
  };

  const handleUpdateSkillName = async (id: number) => {
    if (!editingSkillName.trim()) return;
    try {
      await updateSkill(id, { name: editingSkillName });
      setEditingSkillId(null);
      reloadCategories();
      flash('Đã cập nhật Skill');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi cập nhật Skill');
    }
  };

  const handleToggleSkillActive = async (skill: any) => {
    try {
      await updateSkill(skill.id, { is_active: !skill.is_active });
      reloadCategories();
      flash(`Đã ${!skill.is_active ? 'Kích hoạt' : 'Khóa'} Skill`);
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi cập nhật Skill');
    }
  };

  const handleDeleteSkill = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa Skill này?')) return;
    try {
      await deleteSkill(id);
      reloadCategories();
      flash('Đã xóa Skill thành công');
    } catch (err: any) {
      flash(err.response?.data?.detail || 'Lỗi khi xóa Skill');
    }
  };

  if (!authorized) return null;

  // Flatten active skills for member selection checkboxes
  const activeSkillsForUsers = categories
    .filter(c => c.is_active)
    .flatMap(c =>
      c.groups.map((g: any) => ({
        groupName: g.name,
        categoryName: c.name,
        skills: g.skills.filter((s: any) => s.is_active)
      }))
    )
    .filter(g => g.skills.length > 0);

  // Map skill IDs to names for displaying in users table
  const allSkillsMap = new Map<number, string>();
  categories.forEach(c => {
    c.groups.forEach((g: any) => {
      g.skills.forEach((s: any) => {
        allSkillsMap.set(s.id, `${g.name} > ${s.name}`);
      });
    });
  });

  const selectedCat = categories.find(c => c.id === selectedCatId);
  const selectedGroup = selectedCat?.groups.find((g: any) => g.id === selectedGroupId);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        {/* Header */}
        <div className="h-[56px] bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-40 shadow-sm">
          <h2 className="text-sm font-bold tracking-wider text-[#0f172a] uppercase">Cấu hình hệ thống</h2>
        </div>

        {/* Tabbar Navigation */}
        <div className="bg-white border-b border-slate-200 px-8 flex gap-6 z-30">
          <button
            onClick={() => setActiveTab('members')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'members'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            Quản lý thành viên
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'skills'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            Quản lý kỹ năng
          </button>
          <button
            onClick={() => setActiveTab('system_categories')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'system_categories'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            Danh mục hệ thống
          </button>
        </div>

        {/* Content */}
        <div className="p-8 max-w-7xl w-full mx-auto space-y-6">
          {saved && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-xs flex items-center gap-2 font-semibold shadow-sm animate-fade-in">
              <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              {saved}
            </div>
          )}

          {activeTab === 'members' && (
            <MembersView onFlash={flash} />
          )}


          {activeTab === 'skills' && (
            <>
              <div>
                <h1 className="text-2xl font-bold text-[#0f172a] tracking-tight">Danh Mục Kỹ Năng (Skill Master Data)</h1>
                <p className="text-sm text-slate-500 mt-1">Quản lý cấu trúc kỹ năng 3 cấp (Category &gt; Group &gt; Skill) và trạng thái hoạt động</p>
              </div>

              {/* 3-Column UI Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                {/* Column 1: Category */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[600px]">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
                    <span className="text-xs font-bold text-[#0f172a] uppercase tracking-wider">Cấp 1: Category</span>
                    <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">{categories.length}</span>
                  </div>

                  {/* Category list */}
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {categories.map(cat => {
                      const isSelected = selectedCatId === cat.id;
                      const isEditing = editingCatId === cat.id;

                      return (
                        <div
                          key={cat.id}
                          onClick={() => {
                            if (!isEditing) {
                              setSelectedCatId(cat.id);
                              setSelectedGroupId(null);
                            }
                          }}
                          className={`p-3.5 flex flex-col gap-2 cursor-pointer transition-all ${isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-slate-50/50'
                            }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            {isEditing ? (
                              <div className="flex-1 flex gap-1.5" onClick={e => e.stopPropagation()}>
                                <input
                                  type="text"
                                  value={editingCatName}
                                  onChange={e => setEditingCatName(e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-[#0f172a]"
                                />
                                <button
                                  onClick={() => handleUpdateCategoryName(cat.id)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-[10px] font-bold"
                                >
                                  Lưu
                                </button>
                                <button
                                  onClick={() => setEditingCatId(null)}
                                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded text-[10px] font-bold"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <span className={`font-semibold text-xs leading-relaxed ${cat.is_active ? 'text-[#0f172a]' : 'text-slate-400 line-through'}`}>
                                {cat.name}
                              </span>
                            )}

                            {!isEditing && (
                              <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => {
                                    setEditingCatId(cat.id);
                                    setEditingCatName(cat.name);
                                  }}
                                  className="text-[10px] text-blue-600 hover:underline font-medium"
                                >
                                  Sửa
                                </button>
                                <button
                                  onClick={() => handleToggleCategoryActive(cat)}
                                  className={`text-[10px] font-medium hover:underline ${cat.is_active ? 'text-amber-600' : 'text-emerald-600'}`}
                                >
                                  {cat.is_active ? 'Khóa' : 'Mở'}
                                </button>
                                <button
                                  disabled={cat.is_used}
                                  onClick={() => handleDeleteCategory(cat.id)}
                                  className={`text-[10px] font-medium ${cat.is_used ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:underline'}`}
                                  title={cat.is_used ? 'Không thể xóa: Category đang được sử dụng.' : 'Xóa'}
                                >
                                  Xóa
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider ${cat.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                              }`}>
                              {cat.is_active ? 'Active' : 'Inactive'}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {cat.groups?.length || 0} groups, {cat.groups?.reduce((acc: number, cur: any) => acc + (cur.skills?.length || 0), 0) || 0} skills
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {categories.length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-10 italic">Chưa có Category nào.</p>
                    )}
                  </div>

                  {/* Add category footer */}
                  <form onSubmit={handleAddCategory} className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2 shrink-0">
                    <input
                      required
                      type="text"
                      placeholder="Category mới..."
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none"
                    />
                    <button
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-all shadow-sm"
                    >
                      Thêm
                    </button>
                  </form>
                </div>

                {/* Column 2: Group */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[600px]">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
                    <span className="text-xs font-bold text-[#0f172a] uppercase tracking-wider">Cấp 2: Group</span>
                    {selectedCat && (
                      <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                        {selectedCat.groups?.length || 0}
                      </span>
                    )}
                  </div>

                  {/* Group list */}
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {selectedCatId ? (
                      selectedCat?.groups?.map((grp: any) => {
                        const isSelected = selectedGroupId === grp.id;
                        const isEditing = editingGroupId === grp.id;

                        return (
                          <div
                            key={grp.id}
                            onClick={() => {
                              if (!isEditing) {
                                setSelectedGroupId(grp.id);
                              }
                            }}
                            className={`p-3.5 flex flex-col gap-2 cursor-pointer transition-all ${isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-slate-50/50'
                              }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              {isEditing ? (
                                <div className="flex-1 flex gap-1.5" onClick={e => e.stopPropagation()}>
                                  <input
                                    type="text"
                                    value={editingGroupName}
                                    onChange={e => setEditingGroupName(e.target.value)}
                                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-[#0f172a]"
                                  />
                                  <button
                                    onClick={() => handleUpdateGroupName(grp.id)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-[10px] font-bold"
                                  >
                                    Lưu
                                  </button>
                                  <button
                                    onClick={() => setEditingGroupId(null)}
                                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded text-[10px] font-bold"
                                  >
                                    Hủy
                                  </button>
                                </div>
                              ) : (
                                <span className="font-semibold text-xs text-[#0f172a] leading-relaxed">
                                  {grp.name}
                                </span>
                              )}

                              {!isEditing && (
                                <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                  <button
                                    onClick={() => {
                                      setEditingGroupId(grp.id);
                                      setEditingGroupName(grp.name);
                                    }}
                                    className="text-[10px] text-blue-600 hover:underline font-medium"
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    disabled={grp.is_used}
                                    onClick={() => handleDeleteGroup(grp.id)}
                                    className={`text-[10px] font-medium ${grp.is_used ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:underline'}`}
                                    title={grp.is_used ? 'Không thể xóa: Group đang được sử dụng.' : 'Xóa'}
                                  >
                                    Xóa
                                  </button>
                                </div>
                              )}
                            </div>

                            <span className="text-[10px] text-slate-400">
                              {grp.skills?.length || 0} skills
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-10 italic">Vui lòng chọn Category ở cột bên trái.</p>
                    )}
                    {selectedCatId && selectedCat?.groups?.length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-10 italic">Chưa có Group nào trong Category này.</p>
                    )}
                  </div>

                  {/* Add group footer */}
                  {selectedCatId ? (
                    <form onSubmit={handleAddGroup} className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2 shrink-0">
                      <input
                        required
                        type="text"
                        placeholder="Group mới..."
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none"
                      />
                      <button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-all shadow-sm"
                      >
                        Thêm
                      </button>
                    </form>
                  ) : (
                    <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-[10px] text-slate-400 select-none shrink-0 font-medium uppercase tracking-wider">
                      Chọn Category để thêm Group
                    </div>
                  )}
                </div>

                {/* Column 3: Skill */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[600px]">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
                    <span className="text-xs font-bold text-[#0f172a] uppercase tracking-wider">Cấp 3: Skill</span>
                    {selectedGroup && (
                      <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                        {selectedGroup.skills?.length || 0}
                      </span>
                    )}
                  </div>

                  {/* Skill list */}
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {selectedGroupId ? (
                      selectedGroup?.skills?.map((skill: any) => {
                        const isEditing = editingSkillId === skill.id;

                        return (
                          <div
                            key={skill.id}
                            className="p-3.5 flex flex-col gap-2 transition-all hover:bg-slate-50/50"
                          >
                            <div className="flex items-start justify-between gap-2">
                              {isEditing ? (
                                <div className="flex-1 flex gap-1.5">
                                  <input
                                    type="text"
                                    value={editingSkillName}
                                    onChange={e => setEditingSkillName(e.target.value)}
                                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-[#0f172a]"
                                  />
                                  <button
                                    onClick={() => handleUpdateSkillName(skill.id)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-[10px] font-bold"
                                  >
                                    Lưu
                                  </button>
                                  <button
                                    onClick={() => setEditingSkillId(null)}
                                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded text-[10px] font-bold"
                                  >
                                    Hủy
                                  </button>
                                </div>
                              ) : (
                                <span className={`font-semibold text-xs leading-relaxed ${skill.is_active ? 'text-[#0f172a]' : 'text-slate-400 line-through'}`}>
                                  {skill.name}
                                </span>
                              )}

                              {!isEditing && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={() => {
                                      setEditingSkillId(skill.id);
                                      setEditingSkillName(skill.name);
                                    }}
                                    className="text-[10px] text-blue-600 hover:underline font-medium"
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    onClick={() => handleToggleSkillActive(skill)}
                                    className={`text-[10px] font-medium hover:underline ${skill.is_active ? 'text-amber-600' : 'text-emerald-600'}`}
                                  >
                                    {skill.is_active ? 'Khóa' : 'Mở'}
                                  </button>
                                  <button
                                    disabled={skill.is_used}
                                    onClick={() => handleDeleteSkill(skill.id)}
                                    className={`text-[10px] font-medium ${skill.is_used ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:underline'}`}
                                    title={skill.is_used ? 'Không thể xóa: Skill đang được sử dụng.' : 'Xóa'}
                                  >
                                    Xóa
                                  </button>
                                </div>
                              )}
                            </div>

                            <div>
                              <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider ${skill.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                                }`}>
                                {skill.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-10 italic">Vui lòng chọn Group ở cột ở giữa.</p>
                    )}
                    {selectedGroupId && selectedGroup?.skills?.length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-10 italic">Chưa có Skill nào trong Group này.</p>
                    )}
                  </div>

                  {/* Add skill footer */}
                  {selectedGroupId ? (
                    <form onSubmit={handleAddSkill} className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2 shrink-0">
                      <input
                        required
                        type="text"
                        placeholder="Skill mới..."
                        value={newSkillName}
                        onChange={e => setNewSkillName(e.target.value)}
                        className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-[#0f172a] placeholder-slate-400 focus:border-blue-500 outline-none"
                      />
                      <button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-all shadow-sm"
                      >
                        Thêm
                      </button>
                    </form>
                  ) : (
                    <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-[10px] text-slate-400 select-none shrink-0 font-medium uppercase tracking-wider">
                      Chọn Group để thêm Skill
                    </div>
                  )}
                </div>

              </div>
            </>
          )}

          {activeTab === 'system_categories' && (
            <SystemCategoriesView
              positions={dbPositions}
              departments={dbDepartments}
              priorities={dbPriorities}
              statuses={dbStatuses}
              teams={dbTeams}
              onReload={reloadSystemCategories}
              onFlash={flash}
            />
          )}
        </div>
      </div>

      {/* Edit User Skills Modal */}
      {skillsModalUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 w-full max-w-2xl rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider">Cập nhật kỹ năng thành viên</h3>
                <p className="text-xs text-slate-400 mt-0.5">{skillsModalUser.full_name} ({skillsModalUser.email})</p>
              </div>
              <button
                onClick={() => setSkillsModalUser(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {activeSkillsForUsers.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-6">Chưa có kỹ năng Active nào khả dụng.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {activeSkillsForUsers.map(g => (
                    <div key={g.groupName} className="border border-slate-100 rounded-lg p-3 bg-slate-50/50 space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block border-b border-slate-200/60 pb-1">
                        {g.categoryName} &gt; {g.groupName}
                      </span>
                      <div className="space-y-1.5">
                        {g.skills.map((s: any) => (
                          <label key={s.id} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:text-slate-950">
                            <input
                              type="checkbox"
                              checked={userSkillsForm.includes(s.id)}
                              onChange={e => {
                                const ids = e.target.checked
                                  ? [...userSkillsForm, s.id]
                                  : userSkillsForm.filter(id => id !== s.id);
                                setUserSkillsForm(ids);
                              }}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setSkillsModalUser(null)}
                className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-xs font-bold transition-all"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveUserSkills}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm"
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
