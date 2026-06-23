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
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0] flex">
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        <div className="h-[52px] bg-[#1a1d27] border-b border-[#2e3250] flex items-center justify-between px-6 sticky top-0 z-40">
          <h2 className="text-sm font-bold tracking-wider text-slate-200 uppercase">System Settings</h2>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-slate-200">Hệ Thống Cấu Hình</h1>
            <p className="text-xs text-[#64748b] mt-0.5">Tùy chỉnh phân quyền, bộ lọc, quy tắc AI và kiểm tra lịch sử thao tác</p>
          </div>
        <div className="flex bg-[#1a1d27] border border-[#2e3250] p-1 rounded-lg w-max max-w-full overflow-x-auto mb-6">
          {TABS.map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                tab === t.k
                  ? 'bg-[#22263a] text-[#e2e8f0] shadow-sm'
                  : 'text-[#94a3b8] hover:text-[#e2e8f0]'
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>
        {saved && (
          <div className="mb-4 bg-emerald-950/40 border border-emerald-800/40 text-[#34d399] rounded-lg px-4 py-2.5 text-xs flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {saved}
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-6">
            <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-5 shadow-sm">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-4">Create New User</h2>
              <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  required
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
                <input
                  required
                  placeholder="Full name"
                  value={form.full_name}
                  onChange={e => setForm({ ...form, full_name: e.target.value })}
                  className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
                <input
                  required
                  type="password"
                  placeholder="Password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                >
                  <option value="group_a">Group A – Add sheets, view own</option>
                  <option value="group_b">Group B – View all dashboard</option>
                  <option value="admin">Admin – Full access</option>
                </select>
                <button
                  type="submit"
                  className="col-span-1 md:col-span-2 bg-[#6366f1] hover:bg-[#818cf8] text-white px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-md mt-2"
                >
                  Create User
                </button>
              </form>
            </div>
            <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl overflow-hidden shadow-xl">
              <table className="w-full text-xs text-[#cbd5e1]">
                <thead>
                  <tr className="bg-[#22263a] border-b border-[#2e3250]">
                    <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Email</th>
                    <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Name</th>
                    <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Role</th>
                    <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2e3250]">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-[#1e2235] transition-colors">
                      <td className="px-5 py-3.5 font-medium text-[#e2e8f0]">{u.email}</td>
                      <td className="px-5 py-3 text-[#94a3b8]">{u.full_name}</td>
                      <td className="px-5 py-3">
                        <select
                          value={u.role}
                          onChange={e => updateUser(u.id, { role: e.target.value }).then(() => getUsers().then(setUsers))}
                          className="bg-[#22263a] border border-[#2e3250] rounded px-2.5 py-1 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1]"
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
                              ? 'bg-emerald-950/40 text-[#34d399] border border-emerald-800/40'
                              : 'bg-red-950/40 text-[#f87171] border border-red-800/40'
                          }`}
                        >
                          {u.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => updateUser(u.id, { is_active: !u.is_active }).then(() => getUsers().then(setUsers))}
                            className="text-xs text-[#fdba74] hover:underline font-semibold"
                          >
                            {u.is_active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Delete user?')) deleteUser(u.id).then(() => getUsers().then(setUsers));
                            }}
                            className="text-xs text-[#f87171] hover:underline font-semibold"
                          >
                            Delete
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
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-6 space-y-6 shadow-xl text-[#e2e8f0]">
            <div>
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-1">Column Headers to Check</h2>
              <p className="text-[11px] text-[#64748b] mb-4">
                Enter exact column header names from your Google Sheet. Worker only checks tabs that have ALL these columns.
              </p>
              <div className="space-y-2">
                {colCfg.cols.map((col: string, i: number) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={col}
                      placeholder="e.g. DETAIL TASK"
                      onChange={e => {
                        const c = [...colCfg.cols];
                        c[i] = e.target.value;
                        setColCfg({ ...colCfg, cols: c });
                      }}
                      className="flex-1 bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                    />
                    <button
                      onClick={() => rmCol(i)}
                      className="text-[#f87171] hover:text-red-400 text-xs px-2.5 font-semibold"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addCol}
                className="mt-2 text-xs font-semibold text-[#818cf8] hover:underline"
              >
                + Add column
              </button>
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-1">Tab Names to Check</h2>
              <p className="text-[11px] text-[#64748b] mb-4">
                Leave empty to check ALL tabs. If specified, only these tabs will be checked (must match exactly including slashes).
              </p>
              <div className="space-y-2">
                {(colCfg.tab_names || []).map((t: string, i: number) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={t}
                      placeholder="e.g. 1.Sale/Admin"
                      onChange={e => {
                        const tabs = [...colCfg.tab_names];
                        tabs[i] = e.target.value;
                        setColCfg({ ...colCfg, tab_names: tabs });
                      }}
                      className="flex-1 bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                    />
                    <button
                      onClick={() => rmTab(i)}
                      className="text-[#f87171] hover:text-red-400 text-xs px-2.5 font-semibold"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addTab}
                className="mt-2 text-xs font-semibold text-[#818cf8] hover:underline"
              >
                + Add tab name
              </button>
            </div>
            <div className="pt-2 border-t border-[#2e3250] flex justify-end">
              <button
                onClick={saveCol}
                className="bg-[#6366f1] hover:bg-[#818cf8] text-white px-5 py-2 rounded-lg text-xs font-semibold transition-all shadow-md"
              >
                Save Column Config
              </button>
            </div>
          </div>
        )}

        {tab === 'policy' && (
          <div className="space-y-4">
            <div className="bg-blue-950/40 border border-blue-800/40 text-[#93c5fd] rounded-xl p-4 text-xs">
              <p className="font-bold mb-1">How Policy Rules Work</p>
              <p className="text-[11px] text-[#64748b] leading-relaxed">
                Each rule checks a condition. If Field=Value matches a row, the other checks apply. Leave Value empty to apply to
                all rows. Changes apply from the next check.
              </p>
            </div>
            {policy.rules.map((rule: any, i: number) => (
              <div key={i} className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Rule #{i + 1}</h3>
                  <button
                    onClick={() => rmRule(i)}
                    className="text-[#f87171] hover:text-red-400 text-xs font-semibold"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Field (Column name)</span>
                    <input
                      value={rule.field}
                      placeholder="e.g. PRIORITY"
                      onChange={e => setRule(i, 'field', e.target.value)}
                      className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Value (trigger when field = this)</span>
                    <input
                      value={rule.value}
                      placeholder="e.g. Critical (leave empty = all rows)"
                      onChange={e => setRule(i, 'value', e.target.value)}
                      className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Max Manday (exceed = violation)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={rule.manday_max ?? ''}
                      placeholder="e.g. 3"
                      onChange={e => setRule(i, 'manday_max', e.target.value ? Number(e.target.value) : null)}
                      className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Min Manday (below = violation)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={rule.manday_min ?? ''}
                      placeholder="e.g. 0.5"
                      onChange={e => setRule(i, 'manday_min', e.target.value ? Number(e.target.value) : null)}
                      className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Min Words in Description</span>
                    <input
                      type="number"
                      value={rule.min_words ?? ''}
                      placeholder="e.g. 10"
                      onChange={e => setRule(i, 'min_words', e.target.value ? Number(e.target.value) : null)}
                      className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Required Fields (comma separated)</span>
                    <input
                      value={(rule.required_fields || []).join(',')}
                      placeholder="e.g. ASSIGNED,TICKET ID"
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
                      className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                    />
                  </label>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={addRule}
                className="text-xs font-semibold text-[#818cf8] hover:underline"
              >
                + Add Rule
              </button>
              <button
                onClick={savePol}
                className="bg-[#6366f1] hover:bg-[#818cf8] text-white px-5 py-2 rounded-lg text-xs font-semibold transition-all shadow-md"
              >
                Save Policy
              </button>
            </div>
          </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-6">
            <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-6 space-y-4 shadow-xl">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">AI Connection Setup</h2>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Base URL</span>
                <input
                  value={aiCfg.base_url || ''}
                  onChange={e => setAiCfg({ ...aiCfg, base_url: e.target.value })}
                  className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">New API Key (leave empty to keep current)</span>
                <input
                  type="password"
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="sk-..."
                  className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
                <span className="text-[10px] font-bold text-[#64748b] mt-0.5">
                  {aiCfg.has_key ? '✓ API key configured on server' : '⚠ No API key detected'}
                </span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Model</span>
                <div className="flex gap-2">
                  <input
                    value={aiCfg.model || ''}
                    onChange={e => setAiCfg({ ...aiCfg, model: e.target.value })}
                    placeholder="gpt-4o-mini"
                    className="flex-1 bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                  />
                  <button
                    onClick={fetchModels}
                    disabled={loadingModels}
                    className="bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-xs font-semibold text-[#e2e8f0] px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {loadingModels ? 'Loading...' : 'Fetch Models'}
                  </button>
                </div>
              </label>
              {models.length > 0 && (
                <div className="border border-[#2e3250] rounded-lg p-3 max-h-48 overflow-y-auto bg-[#151821]">
                  <p className="text-[10px] text-[#64748b] font-bold uppercase tracking-wider mb-2">
                    {models.length} models available – click to select:
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {models.map(m => (
                      <button
                        key={m}
                        onClick={() => setAiCfg({ ...aiCfg, model: m })}
                        className={`text-left text-xs px-2.5 py-1.5 rounded transition-all ${
                          aiCfg.model === m
                            ? 'bg-[#6366f1]/20 border border-[#6366f1]/30 text-[#818cf8] font-bold'
                            : 'text-[#94a3b8] hover:text-[#e2e8f0]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Auto Check Interval (hours)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={aiCfg.check_interval_hours || 1}
                    onChange={e => setAiCfg({ ...aiCfg, check_interval_hours: Number(e.target.value) })}
                    className="w-24 bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                  />
                  <span className="text-[11px] text-[#64748b]">hours between automatic checks (1–24)</span>
                </div>
              </label>
            </div>

            <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-6 shadow-xl">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-1">AI System Prompt</h2>
              <p className="text-[11px] text-[#64748b] mb-4">
                This prompt tells the AI how to evaluate tasks. Customize to match your company policy. AI always responds with
                verdict (PASS/FAIL/REVIEW) and suggestion in Vietnamese.
              </p>
              <textarea
                value={aiCfg.system_prompt || ''}
                onChange={e => setAiCfg({ ...aiCfg, system_prompt: e.target.value })}
                rows={18}
                className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2.5 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors font-mono resize-y leading-relaxed"
              />
              <button
                onClick={() => setAiCfg({ ...aiCfg, system_prompt: DEFAULT_PROMPT })}
                className="mt-2 text-xs text-[#64748b] hover:text-[#cbd5e1] hover:underline"
              >
                Reset to default prompt
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={saveAI}
                className="bg-[#6366f1] hover:bg-[#818cf8] text-white px-5 py-2 rounded-lg text-xs font-semibold transition-all shadow-md"
              >
                Save AI Config
              </button>
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl overflow-hidden shadow-xl">
            <table className="w-full text-xs text-[#cbd5e1]">
              <thead>
                <tr className="bg-[#22263a] border-b border-[#2e3250]">
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">User</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Action</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2e3250]">
                {logs.map((l: any) => (
                  <tr key={l.id} className="hover:bg-[#1e2235] transition-colors">
                    <td className="px-5 py-3.5 text-[#e2e8f0] font-medium text-xs">{l.user}</td>
                    <td className="px-5 py-3">
                      <span className="bg-[#6366f1]/15 text-[#818cf8] border border-[#6366f1]/25 px-2.5 py-0.5 rounded text-[10px] font-semibold">
                        {l.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[#64748b] text-[11px] font-medium">
                      {new Date(l.at).toLocaleString('en-GB')}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center py-12 text-[#64748b] font-medium">
                      No audit logs recorded yet
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
