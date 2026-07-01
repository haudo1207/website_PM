'use client';
import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getColumnConfig,
  updateColumnConfig,
  getPolicy,
  updatePolicy,
  getAIConfig,
  updateAIConfig,
  getAIModels,
  getAuditLog
} from '@/lib/api';

type Tab = 'users' | 'columns' | 'policy' | 'ai' | 'audit';

const DEFAULT_PROMPT = `You are an IT/Infra task quality evaluator following company policy.
 
CLASSIFICATION POLICY:
- CRITICAL (20 KPI/manday): Emergency happening + large impact
  * P1: production down, widespread outage, transaction failure
  * Security: credential leak, ransomware, actively exploited CVE
  * Hard deadline: go-live, cutover, major event - delay causes loss
  * Evidence required: alert/incident ID, affected services, user count, SLA deadline
- HIGH (12 KPI/manday): Structural change OR minor emergency
  * P2/P3: intermittent service, latency spike, not full outage
  * Architecture change: HA, segmentation, pipeline, auth system
  * Component migration, automation script affecting prod, RCA analysis
  * Evidence required: ticket/CR + scope + expected impact + rollback plan
- NORMAL (6 KPI/manday): SOP-based, low risk
  * Follow existing checklist, small change, easy rollback
  * No production impact or very limited impact
  * Support tasks, backup/restore test, DNS update, dashboard update
 
RESPOND IN JSON ONLY (no markdown):
{
  "verdict": "PASS/FAIL/REVIEW",
  "reason": "Brief reason in Vietnamese (1-2 sentences)",
  "suggestion": "Specific improvement suggestion in Vietnamese - be concrete:
    - If FAIL: 'Change Priority from X to Y because [reason], add evidence: [what evidence needed]'
    - If REVIEW: 'Need to clarify: [what info], or reconsider [what aspect]'
    - If PASS: 'Task meets standards, no changes needed'"
}`;

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [colCfg, setColCfg] = useState<any>({ cols: [], tab_names: [] });
  const [policy, setPolicy] = useState<any>({ rules: [] });
  const [aiCfg, setAiCfg] = useState<any>({ system_prompt: DEFAULT_PROMPT, check_interval_hours: 1 });
  const [models, setModels] = useState<string[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [saved, setSaved] = useState('');
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'group_a' });
  const [newKey, setNewKey] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);

  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (!isAdmin()) {
      router.push('/dashboard');
    } else {
      setAuthorized(true);
      getUsers().then(setUsers).catch(() => {});
      getColumnConfig().then(setColCfg).catch(() => {});
      getPolicy().then(setPolicy).catch(() => {});
      getAIConfig()
        .then(d => setAiCfg({ ...d, system_prompt: d.system_prompt || DEFAULT_PROMPT }))
        .catch(() => {});
      getAuditLog().then(setLogs).catch(() => {});
    }
  }, []);

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(''), 4000);
  };

  const saveCol = () =>
    updateColumnConfig(colCfg)
      .then(() => flash('Column config saved'))
      .catch(() => flash('Error saving'));
  const savePol = () =>
    updatePolicy(policy)
      .then(() => flash('Policy saved'))
      .catch(() => flash('Error saving'));
  const saveAI = () =>
    updateAIConfig({ ...aiCfg, ...(newKey ? { api_key: newKey } : {}) })
      .then(() => {
        flash('AI config saved');
        setNewKey('');
        getAIConfig().then(d => setAiCfg({ ...d, system_prompt: d.system_prompt || DEFAULT_PROMPT }));
      })
      .catch(() => flash('Error saving'));

  const fetchModels = () => {
    setLoadingModels(true);
    getAIModels()
      .then(r => {
        setModels(r.models || []);
        if (!r.models?.length) flash(r.error || 'No models found');
      })
      .catch(() => flash('Failed to fetch models'))
      .finally(() => setLoadingModels(false));
  };

  const addCol = () => setColCfg((c: any) => ({ ...c, cols: [...c.cols, ''] }));
  const rmCol = (i: number) => {
    const cols = [...colCfg.cols];
    cols.splice(i, 1);
    setColCfg({ ...colCfg, cols });
  };
  const addTab = () => setColCfg((c: any) => ({ ...c, tab_names: [...(c.tab_names || []), ''] }));
  const rmTab = (i: number) => {
    const t = [...colCfg.tab_names];
    t.splice(i, 1);
    setColCfg({ ...colCfg, tab_names: t });
  };

  const addRule = () =>
    setPolicy((p: any) => ({
      ...p,
      rules: [
        ...p.rules,
        { field: 'PRIORITY', value: '', manday_max: null, manday_min: null, min_words: null, required_fields: [] }
      ]
    }));
  const rmRule = (i: number) => {
    const r = [...policy.rules];
    r.splice(i, 1);
    setPolicy({ ...policy, rules: r });
  };
  const setRule = (i: number, k: string, v: any) => {
    const r = [...policy.rules];
    r[i] = { ...r[i], [k]: v };
    setPolicy({ ...policy, rules: r });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createUser(form);
      flash('User created');
      setForm({ email: '', full_name: '', password: '', role: 'group_a' });
      getUsers().then(setUsers);
    } catch {
      flash('Error - email may already exist');
    }
  };

  const TABS = [
    { k: 'users' as Tab, l: 'Users' },
    { k: 'columns' as Tab, l: 'Column Config' },
    { k: 'policy' as Tab, l: 'Policy Rules' },
    { k: 'ai' as Tab, l: 'AI Config' },
    { k: 'audit' as Tab, l: 'Audit Log' }
  ];

  if (!authorized) return null;

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30] flex" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        <div className="h-[52px] bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-6 sticky top-0 z-40">
          <h2 className="text-sm font-bold tracking-wider text-[#0b1c30] uppercase">Cấu hình hệ thống</h2>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-[#0b1c30]">Hệ Thống Cấu Hình</h1>
            <p className="text-xs text-[#565e74] mt-0.5">Tùy chỉnh phân quyền, bộ lọc, quy tắc AI và kiểm tra lịch sử thao tác</p>
          </div>
          <div className="flex bg-[#eff4ff] border border-[#c2c6d6]/60 p-1 rounded-lg w-max max-w-full overflow-x-auto mb-6">
            {TABS.map(t => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                  tab === t.k
                    ? 'bg-white text-[#0058be] shadow-sm'
                    : 'text-[#565e74] hover:text-[#0058be]'
                }`}
              >
                {t.l}
              </button>
            ))}
          </div>
          {saved && (
            <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-2.5 text-xs flex items-center gap-2 font-semibold">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {saved}
            </div>
          )}

          {tab === 'users' && (
            <div className="space-y-6">
              <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-5 shadow-sm">
                <h2 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-4">Tạo tài khoản mới</h2>
                <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    required
                    type="email"
                    placeholder="Email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                  />
                  <input
                    required
                    placeholder="Họ và tên"
                    value={form.full_name}
                    onChange={e => setForm({ ...form, full_name: e.target.value })}
                    className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                  />
                  <input
                    required
                    type="password"
                    placeholder="Mật khẩu"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                  />
                  <select
                    value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value })}
                    className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] transition-colors"
                  >
                    <option value="group_a">Group A – Thêm sheet, xem sheet của mình</option>
                    <option value="group_b">Group B – Xem tất cả dashboard</option>
                    <option value="admin">Admin – Toàn quyền hệ thống</option>
                  </select>
                  <button
                    type="submit"
                    className="col-span-1 md:col-span-2 bg-[#0058be] hover:bg-[#0058be]/90 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md mt-2"
                  >
                    Tạo tài khoản
                  </button>
                </form>
              </div>
              <div className="bg-white border border-[#c2c6d6]/60 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-xs text-[#0b1c30]">
                  <thead>
                    <tr className="bg-[#f8f9ff] border-b border-[#c2c6d6]">
                      <th className="text-left px-5 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Email</th>
                      <th className="text-left px-5 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Họ và tên</th>
                      <th className="text-left px-5 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Vai trò</th>
                      <th className="text-left px-5 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Trạng thái</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#c2c6d6]/40">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-[#eff4ff]/30 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-[#0b1c30]">{u.email}</td>
                        <td className="px-5 py-3 text-[#565e74]">{u.full_name}</td>
                        <td className="px-5 py-3">
                          <select
                            value={u.role}
                            onChange={e => updateUser(u.id, { role: e.target.value }).then(() => getUsers().then(setUsers))}
                            className="bg-white border border-[#c2c6d6] rounded px-2.5 py-1 text-xs text-[#0b1c30] outline-none focus:border-[#0058be]"
                          >
                            <option value="group_a">Group A</option>
                            <option value="group_b">Group B</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              u.is_active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {u.is_active ? 'Đang hoạt động' : 'Đã khóa'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => updateUser(u.id, { is_active: !u.is_active }).then(() => getUsers().then(setUsers))}
                              className="text-xs text-amber-600 hover:text-amber-700 font-semibold"
                            >
                              {u.is_active ? 'Khóa' : 'Kích hoạt'}
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Xóa tài khoản này?')) deleteUser(u.id).then(() => getUsers().then(setUsers));
                              }}
                              className="text-xs text-red-600 hover:text-red-700 font-semibold"
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'columns' && (
            <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-6 space-y-6 shadow-sm text-[#0b1c30]">
              <div>
                <h2 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-1">Các tiêu đề cột cần kiểm tra</h2>
                <p className="text-[11px] text-[#565e74] mb-4">
                  Nhập chính xác tên các tiêu đề cột từ Google Sheet của bạn. Worker chỉ kiểm tra các tab có đủ tất cả các cột này.
                </p>
                <div className="space-y-2">
                  {colCfg.cols.map((col: string, i: number) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={col}
                        placeholder="Ví dụ: DETAIL TASK"
                        onChange={e => {
                          const c = [...colCfg.cols];
                          c[i] = e.target.value;
                          setColCfg({ ...colCfg, cols: c });
                        }}
                        className="flex-1 bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                      />
                      <button
                        onClick={() => rmCol(i)}
                        className="text-red-600 hover:text-red-700 text-xs px-2.5 font-semibold"
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addCol}
                  className="mt-2 text-xs font-semibold text-[#0058be] hover:underline"
                >
                  + Thêm cột mới
                </button>
              </div>
              <div>
                <h2 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-1">Các tên tab cần kiểm tra</h2>
                <p className="text-[11px] text-[#565e74] mb-4">
                  Để trống để kiểm tra TẤT CẢ các tab. Nếu chỉ định, chỉ những tab này mới được kiểm tra (phải khớp hoàn toàn kể cả dấu gạch chéo).
                </p>
                <div className="space-y-2">
                  {(colCfg.tab_names || []).map((t: string, i: number) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={t}
                        placeholder="Ví dụ: 1.Sale/Admin"
                        onChange={e => {
                          const tabs = [...colCfg.tab_names];
                          tabs[i] = e.target.value;
                          setColCfg({ ...colCfg, tab_names: tabs });
                        }}
                        className="flex-1 bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                      />
                      <button
                        onClick={() => rmTab(i)}
                        className="text-red-600 hover:text-red-700 text-xs px-2.5 font-semibold"
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addTab}
                  className="mt-2 text-xs font-semibold text-[#0058be] hover:underline"
                >
                  + Thêm tên tab
                </button>
              </div>
              <div className="pt-2 border-t border-[#c2c6d6]/60 flex justify-end">
                <button
                  onClick={saveCol}
                  className="bg-[#0058be] hover:bg-[#0058be]/90 text-white px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-md"
                >
                  Lưu cấu hình cột
                </button>
              </div>
            </div>
          )}

          {tab === 'policy' && (
            <div className="space-y-4">
              <div className="bg-[#eff4ff] border border-[#0058be]/20 text-[#0058be] rounded-xl p-4 text-xs font-medium">
                <p className="font-bold mb-1">Cách hoạt động của các quy tắc chính sách</p>
                <p className="text-[11px] text-[#565e74] leading-relaxed font-normal">
                  Mỗi quy tắc sẽ kiểm tra một điều kiện. Nếu Field=Value khớp với một dòng, các kiểm tra khác sẽ được áp dụng.
                  Để trống phần Value để áp dụng cho tất cả các dòng. Thay đổi sẽ có hiệu lực từ lượt kiểm tra tiếp theo.
                </p>
              </div>
              {policy.rules.map((rule: any, i: number) => (
                <div key={i} className="bg-white border border-[#c2c6d6]/60 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Quy tắc #{i + 1}</h3>
                    <button
                      onClick={() => rmRule(i)}
                      className="text-red-600 hover:text-red-700 text-xs font-semibold"
                    >
                      Xóa
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Tên cột (Field)</span>
                      <input
                        value={rule.field}
                        placeholder="Ví dụ: PRIORITY"
                        onChange={e => setRule(i, 'field', e.target.value)}
                        className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Giá trị khớp (Value)</span>
                      <input
                        value={rule.value}
                        placeholder="Ví dụ: Critical (để trống = tất cả các dòng)"
                        onChange={e => setRule(i, 'value', e.target.value)}
                        className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Manday tối đa (Vượt quá = vi phạm)</span>
                      <input
                        type="number"
                        step="0.5"
                        value={rule.manday_max ?? ''}
                        placeholder="Ví dụ: 3"
                        onChange={e => setRule(i, 'manday_max', e.target.value ? Number(e.target.value) : null)}
                        className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Manday tối thiểu (Dưới mức = vi phạm)</span>
                      <input
                        type="number"
                        step="0.5"
                        value={rule.manday_min ?? ''}
                        placeholder="Ví dụ: 0.5"
                        onChange={e => setRule(i, 'manday_min', e.target.value ? Number(e.target.value) : null)}
                        className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Số từ tối thiểu trong mô tả</span>
                      <input
                        type="number"
                        value={rule.min_words ?? ''}
                        placeholder="Ví dụ: 10"
                        onChange={e => setRule(i, 'min_words', e.target.value ? Number(e.target.value) : null)}
                        className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Các trường bắt buộc (cách nhau bằng dấu phẩy)</span>
                      <input
                        value={(rule.required_fields || []).join(',')}
                        placeholder="Ví dụ: ASSIGNED,TICKET ID"
                        onChange={e =>
                          setRule(
                            i,
                            'required_fields',
                            e.target.value
                              .split(',')
                              .map((s: string) => s.trim())
                              .filter(Boolean)
                          )
                        }
                        className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                      />
                    </label>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={addRule}
                  className="text-xs font-semibold text-[#0058be] hover:underline"
                >
                  + Thêm quy tắc mới
                </button>
                <button
                  onClick={savePol}
                  className="bg-[#0058be] hover:bg-[#0058be]/90 text-white px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-md"
                >
                  Lưu chính sách
                </button>
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-6">
              <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-6 space-y-4 shadow-sm">
                <h2 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Cấu hình kết nối AI</h2>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Base URL</span>
                  <input
                    value={aiCfg.base_url || ''}
                    onChange={e => setAiCfg({ ...aiCfg, base_url: e.target.value })}
                    className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">API Key mới (để trống để giữ nguyên)</span>
                  <input
                    type="password"
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    placeholder="sk-..."
                    className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                  />
                  <span className="text-[10px] font-bold text-[#565e74] mt-0.5">
                    {aiCfg.has_key ? '✓ API key đã được cấu hình trên máy chủ' : '⚠ Chưa cấu hình API key'}
                  </span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Model</span>
                  <div className="flex gap-2">
                    <input
                      value={aiCfg.model || ''}
                      onChange={e => setAiCfg({ ...aiCfg, model: e.target.value })}
                      placeholder="gpt-4o-mini"
                      className="flex-1 bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                    />
                    <button
                      onClick={fetchModels}
                      disabled={loadingModels}
                      className="bg-[#eff4ff] border border-[#c2c6d6]/60 hover:bg-[#0058be]/10 text-xs font-bold text-[#0058be] px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {loadingModels ? 'Đang tải...' : 'Lấy danh sách model'}
                    </button>
                  </div>
                </label>
                {models.length > 0 && (
                  <div className="border border-[#c2c6d6] rounded-lg p-3 max-h-48 overflow-y-auto bg-[#f8f9ff]">
                    <p className="text-[10px] text-[#565e74] font-bold uppercase tracking-wider mb-2">
                      Có {models.length} model khả dụng – bấm để chọn:
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {models.map(m => (
                        <button
                          key={m}
                          onClick={() => setAiCfg({ ...aiCfg, model: m })}
                          className={`text-left text-xs px-2.5 py-1.5 rounded transition-all ${
                            aiCfg.model === m
                              ? 'bg-[#eff4ff] border border-[#0058be]/30 text-[#0058be] font-bold'
                              : 'text-[#565e74] hover:text-[#0058be]'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Khoảng thời gian tự động kiểm tra (giờ)</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={aiCfg.check_interval_hours || 1}
                      onChange={e => setAiCfg({ ...aiCfg, check_interval_hours: Number(e.target.value) })}
                      className="w-24 bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors"
                    />
                    <span className="text-[11px] text-[#565e74]">giờ giữa các lượt kiểm tra tự động (1–24)</span>
                  </div>
                </label>
              </div>

              <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-6 shadow-sm">
                <h2 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-1">Chỉ thị hệ thống AI (System Prompt)</h2>
                <p className="text-[11px] text-[#565e74] mb-4">
                  Chỉ thị này hướng dẫn AI đánh giá các nhiệm vụ. Tùy chỉnh để khớp với quy định của công ty. AI sẽ phản hồi với
                  kết quả (PASS/FAIL/REVIEW) và đề xuất bằng tiếng Việt.
                </p>
                <textarea
                  value={aiCfg.system_prompt || ''}
                  onChange={e => setAiCfg({ ...aiCfg, system_prompt: e.target.value })}
                  rows={18}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2.5 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] placeholder-[#727785] transition-colors font-mono resize-y leading-relaxed"
                />
                <button
                  onClick={() => setAiCfg({ ...aiCfg, system_prompt: DEFAULT_PROMPT })}
                  className="mt-2 text-xs text-[#565e74] hover:text-[#0b1c30] hover:underline"
                >
                  Khôi phục chỉ thị mặc định
                </button>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={saveAI}
                  className="bg-[#0058be] hover:bg-[#0058be]/90 text-white px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-md"
                >
                  Lưu cấu hình AI
                </button>
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div className="bg-white border border-[#c2c6d6]/60 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-xs text-[#0b1c30]">
                <thead>
                  <tr className="bg-[#f8f9ff] border-b border-[#c2c6d6]">
                    <th className="text-left px-5 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Người thực hiện</th>
                    <th className="text-left px-5 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Hành động</th>
                    <th className="text-left px-5 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Thời gian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#c2c6d6]/40">
                  {logs.map((l: any) => (
                    <tr key={l.id} className="hover:bg-[#eff4ff]/30 transition-colors">
                      <td className="px-5 py-3.5 text-[#0b1c30] font-medium text-xs">{l.user}</td>
                      <td className="px-5 py-3">
                        <span className="bg-[#eff4ff] text-[#0058be] border border-[#0058be]/20 px-2.5 py-0.5 rounded text-[10px] font-bold">
                          {l.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[#565e74] text-[11px] font-medium">
                        {new Date(l.at).toLocaleString('vi-VN')}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center py-12 text-[#565e74] font-medium">
                        Chưa ghi nhận lịch sử hoạt động nào
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
